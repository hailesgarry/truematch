const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");

// NEW: content sniff helpers via dynamic import (ESM package in CJS app)
async function sniffFileMime(absPath) {
  try {
    // file-type is ESM; import dynamically
    const mod = await import("file-type");
    const ft = await mod.fileTypeFromFile(absPath);
    if (ft && ft.mime) return ft.mime;
  } catch {
    // ignore
  }
  // Fallback lightweight SVG detection (XML-based; file-type may return null)
  try {
    const head = fs.readFileSync(absPath, { encoding: "utf8" }).slice(0, 512);
    if (/^\s*<svg[\s>]/i.test(head)) return "image/svg+xml";
  } catch {
    // ignore
  }
  return null;
}

function deleteFileSafe(absPath) {
  try {
    fs.unlinkSync(absPath);
  } catch {
    // ignore
  }
}

// Allowed sets
const ALLOWED_IMAGE_MIMES_PROFILE = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/svg+xml", // allow SVG for avatar/dating to keep current behavior
]);

const ALLOWED_IMAGE_MIMES_CHAT = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  // NOTE: SVG intentionally excluded for chat media for safety
]);

const ALLOWED_VIDEO_MIMES_CHAT = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime", // .mov
  "video/ogg",
]);

const BLOCKED_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

const PRIVATE_IPV4 = [
  /^10\./,
  /^127\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^0\./,
];

const PRIVATE_IPV6 = [/^::1$/, /^fc00:/i, /^fd00:/i, /^fe80:/i];

const LINK_PREVIEW_TIMEOUT_MS = 6000;
const LINK_PREVIEW_MAX_BYTES = 1_000_000; // 1MB cap to avoid huge downloads

function isIpAddress(hostname) {
  return /^[0-9.]+$/.test(hostname) || hostname.includes(":");
}

function isPrivateHost(hostname) {
  if (!hostname) return true;
  const lower = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(lower)) return true;
  if (lower.endsWith(".local")) return true;
  if (isIpAddress(lower)) {
    const isIpv6 = lower.includes(":");
    const rules = isIpv6 ? PRIVATE_IPV6 : PRIVATE_IPV4;
    return rules.some((rx) => rx.test(lower));
  }
  return false;
}

function sanitizeTrim(value) {
  if (!value) return undefined;
  return value.replace(/\s+/g, " ").trim().slice(0, 400);
}

function resolveUrl(base, candidate) {
  if (!candidate) return undefined;
  try {
    return new URL(candidate, base).toString();
  } catch {
    return undefined;
  }
}

// existing controllers imports...
const groupController = require("../controllers/groupController");
const userController = require("../controllers/userController");
const { recordPresence } = require("../lib/metrics");
// Controllers for messages/dating/social-links/bio are handled by Python API now
// Storage is managed by python-service now; keep minimal routes for health and uploads

// No uploads here; uploads moved to Python service

// Health
router.get("/health", (_, res) => res.json({ status: "OK" }));

// Metrics (not sensitive; dev only)
router.get("/metrics", (req, res) => {
  try {
    const { getMetrics } = require("../lib/metrics");
    res.json(getMetrics());
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Prometheus exposition format
router.get("/metrics/prom", (req, res) => {
  try {
    const { promExpose } = require("../lib/metrics");
    res.set("Content-Type", "text/plain; version=0.0.4");
    res.send(promExpose());
  } catch (e) {
    res.status(500).send(`# error ${String(e.message || e)}`);
  }
});

router.get("/link-preview", async (req, res) => {
  const rawUrl = String(req.query.url || "").trim();
  if (!rawUrl) {
    return res.status(400).json({ error: "url query param required" });
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return res.status(400).json({ error: "invalid url" });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return res.status(400).json({ error: "unsupported protocol" });
  }

  if (isPrivateHost(parsed.hostname)) {
    return res.status(400).json({ error: "unsupported host" });
  }

  const normalizedUrl = parsed.toString();

  try {
    const response = await axios.get(normalizedUrl, {
      responseType: "text",
      timeout: LINK_PREVIEW_TIMEOUT_MS,
      maxContentLength: LINK_PREVIEW_MAX_BYTES,
      maxBodyLength: LINK_PREVIEW_MAX_BYTES,
      headers: {
        "User-Agent": "TruematchLinkPreview/1.0 (+https://truematch.example)",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
      validateStatus: (status) => status >= 200 && status < 400,
    });

    const resolvedUrl =
      (response.request?.res && response.request.res.responseUrl) ||
      response.request?.responseUrl ||
      normalizedUrl;

    let finalUrl;
    try {
      finalUrl = new URL(resolvedUrl || normalizedUrl);
    } catch {
      finalUrl = new URL(normalizedUrl);
    }

    if (isPrivateHost(finalUrl.hostname)) {
      return res.status(400).json({ error: "unsupported host" });
    }

    const contentType = String(
      response.headers["content-type"] || ""
    ).toLowerCase();
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml") &&
      !contentType.includes("text/plain")
    ) {
      return res.status(204).send();
    }

    const html =
      typeof response.data === "string"
        ? response.data
        : response.data?.toString?.();

    if (!html) {
      return res.status(204).send();
    }

    const $ = cheerio.load(html);

    const baseHref = finalUrl.toString();

    const title =
      sanitizeTrim($("meta[property='og:title']").attr("content")) ||
      sanitizeTrim($("meta[name='twitter:title']").attr("content")) ||
      sanitizeTrim($("title").first().text());

    const description =
      sanitizeTrim($("meta[property='og:description']").attr("content")) ||
      sanitizeTrim($("meta[name='description']").attr("content"));

    const siteName =
      sanitizeTrim($("meta[property='og:site_name']").attr("content")) ||
      finalUrl.hostname;

    const ogUrl = sanitizeTrim($("meta[property='og:url']").attr("content"));
    const canonical = sanitizeTrim($("link[rel='canonical']").attr("href"));
    const resolvedCanonical =
      resolveUrl(baseHref, ogUrl) || resolveUrl(baseHref, canonical);

    const image = resolveUrl(
      baseHref,
      sanitizeTrim($("meta[property='og:image']").attr("content")) ||
        sanitizeTrim($("meta[name='twitter:image']").attr("content")) ||
        sanitizeTrim($("meta[property='og:image:url']").attr("content"))
    );

    let favicon;
    const iconSelectors = [
      "link[rel='icon']",
      "link[rel='shortcut icon']",
      "link[rel='apple-touch-icon']",
      "link[rel='apple-touch-icon-precomposed']",
    ];
    for (const selector of iconSelectors) {
      const href = sanitizeTrim($(selector).attr("href"));
      const resolved = resolveUrl(baseHref, href);
      if (resolved) {
        favicon = resolved;
        break;
      }
    }

    const payload = {
      url: normalizedUrl,
      ...(finalUrl && finalUrl.toString() !== normalizedUrl
        ? { finalUrl: finalUrl.toString() }
        : {}),
      ...(resolvedCanonical ? { finalUrl: resolvedCanonical } : {}),
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(siteName ? { siteName } : {}),
      ...(favicon ? { favicon } : {}),
      ...(image ? { image } : {}),
    };

    // If we didn't find any metadata beyond the bare URL, avoid spamming the UI.
    const hasMetadata = Boolean(
      payload.title || payload.description || payload.image || payload.siteName
    );
    if (!hasMetadata) {
      return res.status(204).send();
    }

    return res.json(payload);
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[link-preview]", err?.message || err);
    }
    return res.status(204).send();
  }
});

// Cloudinary status moved to Python service

// Messages (legacy snapshot)
router.all(/^\/messages\/.*$/, (_req, res) =>
  res.status(501).json({ error: "Use Python API for messages" })
);

// Stream metrics for a group
router.get("/groups/:groupId/stream-metrics", (_req, res) =>
  res.status(501).json({ error: "Use Python API for stream metrics" })
);

// Online counts only
router.get("/groups/online-counts", (req, res) => {
  res.json(userController.getOnlineCounts());
});

// Groups list
router.get("/groups", (req, res) => {
  const include = req.query.includeOnline === "true";
  const groupsObj = groupController.getAllGroups(); // returns map
  let groups = Object.values(groupsObj);
  if (include) {
    const counts = userController.getOnlineCounts();
    groups = groups.map((g) => ({ ...g, onlineCount: counts[g.id] || 0 }));
  }
  res.json(groups);
});

router.get("/groups/:groupId", (req, res) => {
  const g = groupController.getGroup(req.params.groupId);
  if (!g) return res.status(404).json({ error: "Group not found" });
  const counts = userController.getOnlineCounts();
  res.json({ ...g, onlineCount: counts[g.id] || 0 });
});

// Create a new group
router.post("/groups", (req, res) => {
  try {
    const { id, name, description, avatarUrl } = req.body || {};
    const gid =
      String(id || "").trim() ||
      String(
        (name || "")
          .toLowerCase()
          .replace(/[^a-z0-9-]+/gi, "-")
          .replace(/^-+|-+$/g, "")
      ).trim();
    const cleanId = gid.toLowerCase();
    const cleanName = String(name || id || "").trim();
    if (!cleanId || !cleanName) {
      return res.status(400).json({ error: "id or name required" });
    }
    if (groupController.getGroup(cleanId)) {
      return res.status(409).json({ error: "Group id already exists" });
    }
    const group = {
      id: cleanId,
      name: cleanName,
      ...(description ? { description: String(description) } : {}),
      ...(avatarUrl ? { avatarUrl: String(avatarUrl) } : {}),
    };
    const saved = groupController.addGroup(group);
    res.status(201).json(saved);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Update a group
router.put("/groups/:groupId", (req, res) => {
  try {
    const groupId = String(req.params.groupId || "").trim();
    const existing = groupController.getGroup(groupId);
    if (!existing) return res.status(404).json({ error: "Group not found" });
    const { name, description, avatarUrl } = req.body || {};
    const data = {};
    if (name) data.name = String(name).trim();
    if (description !== undefined) data.description = String(description);
    if (avatarUrl !== undefined) data.avatarUrl = String(avatarUrl);
    const saved = groupController.updateGroup(groupId, data);
    res.json(saved);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Delete a group (and its messages)
router.delete("/groups/:groupId", async (req, res) => {
  return res.status(501).json({ error: "Use Python API for group deletion" });
});

// Upload and set a group's avatar directly; persists avatarUrl in storage
// Group avatar upload moved to Python service

// Group members
router.get("/groups/:groupId/users", (req, res) => {
  const groupId = req.params.groupId;
  const members = userController.getUsersByGroup(groupId) || [];
  res.json(members);
});

// Active users (random sample with total)
router.get("/groups/:groupId/active-users", (req, res) => {
  try {
    const groupId = String(req.params.groupId || "").trim();
    if (!groupId) return res.status(400).json({ error: "groupId required" });
    const limit = Math.max(
      0,
      Math.min(
        50,
        Number.isFinite(Number(req.query.limit)) ? Number(req.query.limit) : 3
      )
    );
    const users = userController.getUsersByGroup(groupId) || [];
    const total = users.length;
    if (total === 0) return res.json({ total: 0, users: [] });
    // Deterministic sort to avoid avatar flicker in UI
    const sorted = users.slice().sort((a, b) =>
      String(a.username || "")
        .toLowerCase()
        .localeCompare(String(b.username || "").toLowerCase())
    );
    const sample = limit > 0 ? sorted.slice(0, limit) : sorted;

    // Only expose minimal fields for the avatar stack
    const payload = sample.map((u) => ({
      username: u.username,
      avatar: u.avatar ?? null,
    }));
    res.json({ total, users: payload });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Batch active users: /groups/active-users/batch?groups=a,b,c&limit=3
router.get("/groups/active-users/batch", (req, res) => {
  try {
    const start = Date.now();
    const groupsParam = String(req.query.groups || "").trim();
    if (!groupsParam) return res.json({ groups: {} });
    const limit = Math.max(
      0,
      Math.min(
        50,
        Number.isFinite(Number(req.query.limit)) ? Number(req.query.limit) : 3
      )
    );
    const ids = groupsParam
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const out = {};
    for (const groupId of ids) {
      const users = userController.getUsersByGroup(groupId) || [];
      const total = users.length;
      // Deterministic sort to minimize UI flicker
      const sorted = users.slice().sort((a, b) =>
        String(a.username || "")
          .toLowerCase()
          .localeCompare(String(b.username || "").toLowerCase())
      );
      const sample = limit > 0 ? sorted.slice(0, limit) : sorted;
      out[groupId] = {
        total,
        users: sample.map((u) => ({
          username: u.username,
          avatar: u.avatar ?? null,
        })),
      };
    }
    const ms = Date.now() - start;
    recordPresence(ids, ms, true);
    res.json({ groups: out, ms });
  } catch (e) {
    recordPresence([], 0, false);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ----------------------
// Dating Profiles
// ----------------------

// Upload a dating photo; returns { url }
// Dating photo upload moved to Python service

// NEW: Avatar upload -> returns absolute URL
// Avatar upload moved to Python service

// NEW: Chat media upload -> returns absolute URL
// Chat media upload moved to Python service

// Get all profiles
router.all(/^\/dating\/.*$/, (_req, res) =>
  res.status(501).json({ error: "Use Python API for dating" })
);

// ----------------------
// Social Links
// ----------------------

router.all(/^\/users\/.*social-links.*$/, (_req, res) =>
  res.status(501).json({ error: "Use Python API for social-links" })
);

// Resolve userId by username (online users only)
router.get("/users/resolve-id/:username", (req, res) => {
  try {
    const username = String(req.params.username || "")
      .trim()
      .toLowerCase();
    const u = (userController.getAllUsers?.() || []).find(
      (x) =>
        String(x.username || "")
          .trim()
          .toLowerCase() === username
    );
    if (u && u.userId) return res.json({ userId: u.userId });
    return res.status(404).json({ error: "Not found" });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// ----------------------
// User Bio (by userId)
// ----------------------

router.all(/^\/users\/[^/]+\/bio$/, (_req, res) =>
  res.status(501).json({ error: "Use Python API for bio" })
);

module.exports = router;
