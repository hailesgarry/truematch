const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const {
  isEnabled: cloudEnabled,
  ensureConfigured,
} = require("../config/cloudinary");
const { getStatus: getCloudStatus } = require("../config/cloudinary");

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

// existing controllers imports...
const messageController = require("../controllers/messageController");
const groupController = require("../controllers/groupController");
const userController = require("../controllers/userController");
const datingController = require("../controllers/datingController");
const socialLinksController = require("../controllers/socialLinksController");
const bioController = require("../controllers/bioController");
const storage = require("../models/storage");

// No local upload directories; Cloudinary is used for storage

// existing dating storage...
const uploadMemory = multer.memoryStorage();

const upload = multer({
  storage: uploadMemory,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const ok = /^image\//i.test(file.mimetype);
    cb(ok ? null : new Error("Only image uploads are allowed"), ok);
  },
});

const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const ok = /^image\//i.test(file.mimetype);
    cb(ok ? null : new Error("Only image uploads are allowed"), ok);
  },
});

const uploadChatMedia = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
  fileFilter: (_req, file, cb) => {
    const ok =
      /^image\//i.test(file.mimetype) || /^video\//i.test(file.mimetype);
    cb(ok ? null : new Error("Only image/video uploads are allowed"), ok);
  },
});

// Health
router.get("/health", (_, res) => res.json({ status: "OK" }));

// Cloudinary status (for frontend to detect configuration)
router.get("/cloudinary/status", (_req, res) => {
  try {
    const status = getCloudStatus ? getCloudStatus() : { configured: false };
    return res.json(status);
  } catch {
    return res.json({ configured: false });
  }
});

// Messages (legacy snapshot)
router.get("/messages/:groupId", async (req, res) => {
  const { before, limit } = req.query || {};
  // If paged params provided, use Streams paging
  if (before !== undefined || limit !== undefined) {
    try {
      const result = await messageController.page(req.params.groupId, {
        before: typeof before === "string" && before ? before : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.json(result);
    } catch (e) {
      return res.status(500).json({ error: String(e.message || e) });
    }
  }
  // fallback to snapshot for minimal change
  return res.json(messageController.getMessages(req.params.groupId));
});

// Stream metrics for a group
router.get("/groups/:groupId/stream-metrics", async (req, res) => {
  try {
    const metrics = await messageController.streamMetrics(req.params.groupId);
    res.json(metrics);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

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
  try {
    const groupId = String(req.params.groupId || "").trim();
    const existing = groupController.getGroup(groupId);
    if (!existing) return res.status(404).json({ error: "Group not found" });
    const ok = groupController.deleteGroup(groupId);
    if (!ok) return res.status(500).json({ error: "Delete failed" });
    // Ensure Redis state is updated immediately
    try {
      await storage.setGroups(groupController.getAllGroups());
    } catch (e) {
      console.warn("Warning: Failed to persist groups after delete", e);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Upload and set a group's avatar directly; persists avatarUrl in Redis
router.post(
  "/groups/:groupId/avatar",
  uploadAvatar.single("avatar"),
  async (req, res) => {
    try {
      const groupId = String(req.params.groupId || "").trim();
      const existing = groupController.getGroup(groupId);
      if (!existing) return res.status(404).json({ error: "Group not found" });
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      if (!cloudEnabled())
        return res.status(500).json({ error: "Cloudinary not configured" });
      ensureConfigured();
      const mime = req.file.mimetype;
      if (!ALLOWED_IMAGE_MIMES_PROFILE.has(mime)) {
        return res.status(415).json({
          error: `Unsupported image type: ${mime}. Allowed images: JPEG, PNG, WebP, GIF, AVIF, SVG.`,
        });
      }
      const { uploadDataUrl } = require("../config/cloudinary");
      const b64 = `data:${mime};base64,${req.file.buffer.toString("base64")}`;
      const url = await uploadDataUrl(b64, {
        folder: process.env.CLOUDINARY_AVATAR_FOLDER || "funly/avatars",
        resourceType: "image",
      });
      const saved = groupController.updateGroup(groupId, { avatarUrl: url });
      return res.json({ url, group: saved });
    } catch (e) {
      return res.status(500).json({ error: "Upload failed" });
    }
  }
);

// Group members
router.get("/groups/:groupId/users", (req, res) => {
  const groupId = req.params.groupId;
  const members = userController.getUsersByGroup(groupId) || [];
  res.json(members);
});

// ----------------------
// Dating Profiles
// ----------------------

// Upload a dating photo; returns { url }
router.post(
  "/uploads/dating-photo",
  upload.single("photo"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    if (!cloudEnabled())
      return res.status(500).json({ error: "Cloudinary not configured" });
    ensureConfigured();
    const b64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString(
      "base64"
    )}`;
    if (!ALLOWED_IMAGE_MIMES_PROFILE.has(req.file.mimetype)) {
      return res.status(415).json({
        error: `Unsupported image type: ${req.file.mimetype}. Allowed images: JPEG, PNG, WebP, GIF, AVIF, SVG.`,
      });
    }
    try {
      const { uploadDataUrl } = require("../config/cloudinary");
      const url = await uploadDataUrl(b64, {
        folder: process.env.CLOUDINARY_DATING_FOLDER || "funly/dating",
        resourceType: "image",
      });
      return res.json({ url, type: req.file.mimetype });
    } catch (e) {
      return res.status(500).json({ error: "Upload failed" });
    }
  }
);

// NEW: Avatar upload -> returns absolute URL
router.post(
  "/uploads/avatar",
  uploadAvatar.single("avatar"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    if (!cloudEnabled())
      return res.status(500).json({ error: "Cloudinary not configured" });
    ensureConfigured();
    const mime = req.file.mimetype;
    if (!ALLOWED_IMAGE_MIMES_PROFILE.has(mime)) {
      return res.status(415).json({
        error: `Unsupported image type: ${mime}. Allowed images: JPEG, PNG, WebP, GIF, AVIF, SVG.`,
      });
    }
    try {
      const { uploadDataUrl } = require("../config/cloudinary");
      const b64 = `data:${mime};base64,${req.file.buffer.toString("base64")}`;
      const url = await uploadDataUrl(b64, {
        folder: process.env.CLOUDINARY_AVATAR_FOLDER || "funly/avatars",
        resourceType: "image",
      });
      return res.json({ url, type: mime });
    } catch (e) {
      return res.status(500).json({ error: "Upload failed" });
    }
  }
);

// NEW: Chat media upload -> returns absolute URL
router.post(
  "/uploads/chat-media",
  uploadChatMedia.single("media"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    if (!cloudEnabled())
      return res.status(500).json({ error: "Cloudinary not configured" });
    ensureConfigured();
    const mime = req.file.mimetype;
    const isImage = ALLOWED_IMAGE_MIMES_CHAT.has(mime);
    const isVideo = ALLOWED_VIDEO_MIMES_CHAT.has(mime);
    if (mime === "image/svg+xml") {
      return res
        .status(415)
        .json({ error: "SVG images are not allowed for chat media." });
    }
    if (!isImage && !isVideo) {
      return res.status(415).json({ error: `Unsupported type: ${mime}.` });
    }
    try {
      const { uploadDataUrl } = require("../config/cloudinary");
      const b64 = `data:${mime};base64,${req.file.buffer.toString("base64")}`;
      const url = await uploadDataUrl(b64, {
        folder: process.env.CLOUDINARY_CHAT_FOLDER || "funly/chat",
        resourceType: isVideo ? "video" : "image",
      });
      return res.json({ url, type: mime });
    } catch (e) {
      return res.status(500).json({ error: "Upload failed" });
    }
  }
);

// Get all profiles
router.get("/dating/profiles", (_req, res) => {
  res.json(datingController.getAllProfiles());
});

// Get one profile
router.get("/dating/profile/:username", (req, res) => {
  const p = datingController.getProfile(req.params.username);
  if (!p) return res.status(404).json({ error: "Not found" });
  res.json(p);
});

// Upsert profile (ACCEPT NEW FIELDS)
router.put("/dating/profile", (req, res) => {
  const {
    username,
    photoUrl,
    photo,
    mood,
    location,
    age,
    religion,
    gender, // NEW
    photos, // NEW
    preferences, // NEW
  } = req.body || {};
  if (!username) return res.status(400).json({ error: "username required" });
  try {
    const saved = datingController.upsertProfile({
      username,
      photoUrl,
      photo,
      mood,
      location,
      age,
      religion,
      gender, // NEW
      photos, // NEW
      preferences, // NEW
    });
    res.json(saved);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// Delete a single photo from a user's dating profile
router.delete("/dating/profile/:username/photo", (req, res) => {
  try {
    const username = String(req.params.username || "").trim();
    const raw = req.query.url;
    const url = Array.isArray(raw) ? raw[0] : String(raw || "");
    if (!username) return res.status(400).json({ error: "username required" });
    if (!url) return res.status(400).json({ error: "url query required" });
    const updated = datingController.removePhoto(username, url);
    if (!updated) return res.status(404).json({ error: "Not found" });
    return res.json(updated);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

// Delete a dating profile completely (profile + related likes)
router.delete("/dating/profile/:username", (req, res) => {
  try {
    const username = String(req.params.username || "").trim();
    if (!username) return res.status(400).json({ error: "username required" });
    const ok = datingController.deleteProfile(username);
    if (!ok) return res.status(404).json({ error: "Not found" });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

// OPTIONAL: server-side recommendation route (uses user's preferences)
router.get("/dating/profiles/recommended", (req, res) => {
  const user = String(req.query.user || "").trim();
  try {
    const result = datingController.filterByPreferencesForUser(user);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// Get profiles by a batch of usernames (?users=a,b,c)
router.get("/dating/profiles/batch", (req, res) => {
  const raw = String(req.query.users || "").trim();
  if (!raw) return res.json([]);
  const usernames = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    const profiles = datingController.getProfilesByUsernames(usernames);
    res.json(profiles);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// ----------------------
// Social Links
// ----------------------

router.get("/users/:username/social-links", (req, res) => {
  try {
    const username = String(req.params.username || "");
    // First, try legacy username-keyed storage
    const out = socialLinksController.getLinks(username);
    if (Array.isArray(out) && out.length) return res.json(out);

    // Fallback: resolve current online user's ID and return ID-keyed links
    const unameLower = username.trim().toLowerCase();
    const u = (userController.getAllUsers?.() || []).find(
      (x) =>
        String(x.username || "")
          .trim()
          .toLowerCase() === unameLower
    );
    if (u && u.userId) {
      const idLinks = socialLinksController.getLinksById(u.userId, username);
      return res.json(idLinks);
    }
    return res.json([]);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

router.put("/users/:username/social-links", (req, res) => {
  try {
    const links = Array.isArray(req.body) ? req.body : req.body?.links;
    if (!Array.isArray(links)) {
      return res.status(400).json({ error: "links array required" });
    }
    const out = socialLinksController.setLinks(req.params.username, links);
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// Migrate social links from one username to another
router.post("/users/migrate-social-links", (req, res) => {
  const { from, to } = req.body || {};
  try {
    const out = socialLinksController.migrate(from, to);
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// ID-based endpoints (preferred)
router.get("/users/id/:userId/social-links", (req, res) => {
  try {
    const { userId } = req.params;
    const legacy = String(req.query.legacy || "");
    const out = socialLinksController.getLinksById(userId, legacy);
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

router.put("/users/id/:userId/social-links", (req, res) => {
  try {
    const links = Array.isArray(req.body) ? req.body : req.body?.links;
    if (!Array.isArray(links)) {
      return res.status(400).json({ error: "links array required" });
    }
    const out = socialLinksController.setLinksById(req.params.userId, links);
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

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

router.get("/users/id/:userId/bio", (req, res) => {
  try {
    const { userId } = req.params;
    const bio = bioController.getBioById(userId);
    res.json({ bio });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

router.put("/users/id/:userId/bio", (req, res) => {
  try {
    const { userId } = req.params;
    const text =
      typeof req.body === "string" ? req.body : String(req.body?.bio || "");
    const saved = bioController.setBioById(userId, text);
    res.json({ bio: saved });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

module.exports = router;
