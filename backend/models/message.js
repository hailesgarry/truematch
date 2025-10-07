const fs = require("fs");
const path = require("path");
const {
  isEnabled: cloudEnabled,
  uploadDataUrl,
} = require("../config/cloudinary");
const crypto = require("crypto");
const config = require("../config");
const storage = require("./storage");

function genId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // Fallback: time + random
  return (
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10) +
    "-" +
    process.pid
  );
}

// Retention/window size for GROUPS (not DMs)
const MAX_GROUP_MESSAGES = Number(process.env.GROUP_MESSAGE_MAX || 100);
function isDmId(id) {
  return typeof id === "string" && id.startsWith("dm:");
}

class MessageModel {
  constructor() {
    // Only use the data directory location
    this.MESSAGES_FILE = path.join(
      __dirname,
      "..",
      "data",
      "chat_messages.json"
    );
    this.CHAT_DIR = path.join(__dirname, "..", "uploads", "chat");
    this.messagesByGroup = {};
  }

  init() {
    this.loadMessages();
  }

  loadMessages() {
    (async () => {
      try {
        // Ensure chat uploads directory exists for potential migrations
        try {
          fs.mkdirSync(this.CHAT_DIR, { recursive: true });
        } catch {}

        // Load all legacy JSON-array message buckets for DMs/groups, then hydrate cache
        // Reconcile against existing groups to prevent orphaned message buckets
        this.messagesByGroup = {};
        const groupIds = await storage.listMessageGroupIds();
        let orphanCount = 0;
        let orphanDeleted = 0;
        let hydrated = 0;
        let groupsMap = {};
        try {
          groupsMap = (await storage.getGroups()) || {};
        } catch {}
        const allowed = new Set(Object.keys(groupsMap || {}));

        // Track trims done at load to enforce retention
        let trimmedAtLoad = 0;

        for (const gid of groupIds) {
          if (allowed.size && !allowed.has(gid)) {
            // Orphaned messages for a non-existent group: delete to clean up
            orphanCount++;
            try {
              const ok = await storage.deleteMessages(gid);
              if (ok) orphanDeleted++;
            } catch {}
            continue;
          }
          let arr = await storage.getMessages(gid);
          arr = Array.isArray(arr) ? arr : [];
          // Only enforce trim on legacy non-DM buckets
          if (
            !isDmId(gid) &&
            MAX_GROUP_MESSAGES > 0 &&
            arr.length > MAX_GROUP_MESSAGES
          ) {
            const trimmed = arr.length - MAX_GROUP_MESSAGES;
            arr = arr.slice(-MAX_GROUP_MESSAGES);
            try {
              await storage.setMessages(gid, arr);
            } catch {}
            trimmedAtLoad += trimmed;
          }
          this.messagesByGroup[gid] = arr;
          hydrated++;
        }

        // If empty, try to import from existing file once (migration)
        if (
          Object.keys(this.messagesByGroup).length === 0 &&
          fs.existsSync(this.MESSAGES_FILE)
        ) {
          try {
            const data = fs.readFileSync(this.MESSAGES_FILE, "utf8");
            const parsed = JSON.parse(data);
            if (parsed && typeof parsed === "object") {
              this.messagesByGroup = parsed;
              // backfill ids and normalize media
              let added = 0;
              for (const [g, arr] of Object.entries(this.messagesByGroup)) {
                if (Array.isArray(arr)) {
                  arr.forEach((m) => {
                    if (!m.messageId) {
                      m.messageId = genId();
                      added++;
                    }
                  });
                }
              }
              const changed = this.migrateMediaToUrls();
              // save to Redis per group
              for (const [g, arr] of Object.entries(this.messagesByGroup)) {
                await storage.setMessages(g, arr);
              }
              if (added > 0)
                console.log(`Backfilled ${added} messages with messageId`);
              if (changed)
                console.log(
                  `Migrated ${changed} messages' media to URL format`
                );
              const total = Object.values(this.messagesByGroup).reduce(
                (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
                0
              );
              console.log(`Imported ${total} messages from file into Redis`);
            }
          } catch (e) {
            console.warn(
              "Failed to import existing messages file:",
              e?.message || e
            );
          }
        }

        const total = Object.values(this.messagesByGroup).reduce(
          (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
          0
        );
        const groupBuckets = Object.keys(this.messagesByGroup).length;
        let msg = `Loaded legacy message buckets for ${groupBuckets} ids (${total} total messages)`;
        if (orphanCount) {
          msg += `; cleaned ${orphanDeleted}/${orphanCount} orphaned message buckets`;
        }
        if (trimmedAtLoad) {
          msg += `; trimmed ${trimmedAtLoad} excess messages to cap ${MAX_GROUP_MESSAGES}`;
        }
        console.log(msg);
      } catch (err) {
        console.error("Error loading messages from Redis:", err);
        this.messagesByGroup = {};
      }
    })();
  }

  saveMessages() {
    (async () => {
      try {
        for (const [gid, arr] of Object.entries(this.messagesByGroup)) {
          await storage.setMessages(gid, Array.isArray(arr) ? arr : []);
        }
      } catch (err) {
        console.error("Error saving messages to Redis:", err);
      }
    })();
  }

  saveGroup(groupId) {
    (async () => {
      try {
        const arr = this.messagesByGroup[groupId] || [];
        await storage.setMessages(groupId, Array.isArray(arr) ? arr : []);
      } catch (err) {
        console.error("Error saving group messages to Redis:", err);
      }
    })();
  }

  // =========================
  // Migration helpers: media to URLs
  // =========================

  // Build absolute URL from a server-relative uploads path
  toAbsolute(urlPath) {
    if (!urlPath) return urlPath;
    const p = urlPath.startsWith("/") ? urlPath : `/${urlPath}`;
    const port = config.port || 8080;
    const proto = "http"; // assume http in dev; can be improved with env
    return `${proto}://localhost:${port}${p}`;
  }

  // Save data URL image/video via Cloudinary and return absolute URL
  saveDataUrlToChatFile(username, dataUrl) {
    if (typeof dataUrl !== "string") return null;
    const m = dataUrl.match(
      /^data:((?:image|video)\/[a-z0-9+\-.]+);base64,([a-z0-9+/=]+)$/i
    );
    if (!m) return null;
    const mime = m[1].toLowerCase();
    try {
      if (cloudEnabled()) {
        const folder = process.env.CLOUDINARY_CHAT_FOLDER || "funly/chat";
        const url = fs.existsSync(this.CHAT_DIR) // noisy check avoided; just try upload
          ? null
          : null;
        const dataUrlStr = dataUrl; // already a data URL
        return uploadDataUrl(dataUrlStr, {
          folder,
          resourceType: mime.startsWith("video/") ? "video" : "image",
        });
      }
    } catch {}
    return null;
  }

  // Normalize a possibly data/relative URL to absolute using model context
  normalizeStoredUrl(username, value) {
    if (value == null) return value;
    const val = String(value).trim();
    if (!val) return val;
    if (/^https?:\/\//i.test(val)) return val;
    if (/^data:(?:image|video)\//i.test(val)) {
      try {
        const abs = this.saveDataUrlToChatFile(username, val);
        return abs || val;
      } catch {
        return val;
      }
    }
    // Legacy local uploads paths are no longer served; keep value as-is
    if (val.startsWith("/uploads/")) return val;
    if (val.startsWith("uploads/")) return val;
    return val;
  }

  migrateMediaToUrls() {
    let migratedCount = 0;
    const processMedia = (username, media) => {
      if (!media || typeof media !== "object") return null;
      let changed = false;
      const out = { ...media };
      for (const key of ["original", "preview", "gif", "thumbnail"]) {
        if (out[key] !== undefined) {
          const next = this.normalizeStoredUrl(username, out[key]);
          if (next !== out[key]) {
            out[key] = next;
            changed = true;
          }
        }
      }
      return changed ? out : null;
    };

    for (const [gid, arr] of Object.entries(this.messagesByGroup)) {
      if (!Array.isArray(arr)) continue;
      let groupChanged = false;
      for (let i = 0; i < arr.length; i++) {
        const m = arr[i];
        let msgChanged = false;

        // Normalize message text if it's an uploads path
        if (typeof m.text === "string") {
          const nextText = this.normalizeStoredUrl(m.username, m.text);
          if (nextText !== m.text) {
            m.text = nextText;
            msgChanged = true;
          }
        }

        // Normalize media
        const maybe = processMedia(m.username, m.media);
        if (maybe) {
          m.media = maybe;
          msgChanged = true;
        }

        // Normalize reply media if present
        if (m.replyTo && m.replyTo.media) {
          const rMaybe = processMedia(m.replyTo.username, m.replyTo.media);
          if (rMaybe) {
            m.replyTo = { ...m.replyTo, media: rMaybe };
            msgChanged = true;
          }
        }

        if (msgChanged) {
          arr[i] = m;
          groupChanged = true;
          migratedCount++;
        }
      }
      if (groupChanged) this.messagesByGroup[gid] = arr;
    }
    return migratedCount;
  }

  getMessagesByGroup(groupId) {
    // Returns last cached window and kicks off an async refresh
    return this._getGroupStreamWindowSync(groupId, MAX_GROUP_MESSAGES);
  }

  async getLatestWindow(groupId, count) {
    const n = Math.max(1, Number(count || MAX_GROUP_MESSAGES));
    const list = await storage.xRangeLatest(groupId, n, { reverse: true });
    const ids = list.map((m) => m.messageId).filter(Boolean);
    const [overlays, reacts] = await Promise.all([
      storage.overlayGetMany(groupId, ids),
      storage.reactionsGetMany(groupId, ids),
    ]);
    const merged = list.map((m) => ({
      ...m,
      ...(overlays?.[m.messageId] || {}),
      reactions: reacts?.[m.messageId] || {},
    }));
    // update cache
    this._lastWindows = this._lastWindows || new Map();
    this._lastWindows.set(groupId, merged);
    return merged;
  }

  addMessage(groupId, message) {
    // Ensure base fields
    if (!message.messageId) message.messageId = genId();
    if (!message.edits) message.edits = [];
    if (message.lastEditedAt === undefined) message.lastEditedAt = null;
    if (message.edited === undefined) message.edited = false;
    // Streams for all rooms (groups and DMs)
    (async () => {
      try {
        const id = await storage.xaddGroupMessage(
          groupId,
          { json: JSON.stringify(message) },
          MAX_GROUP_MESSAGES
        );
        if (id) message.streamId = id;
        // update cache window opportunistically
        const snap = this._getGroupStreamWindowSync(
          groupId,
          MAX_GROUP_MESSAGES
        );
        const merged = (snap || [])
          .concat([{ ...message }])
          .slice(-MAX_GROUP_MESSAGES);
        this._lastWindows = this._lastWindows || new Map();
        this._lastWindows.set(groupId, merged);
      } catch (e) {
        console.error("xaddGroupMessage failed:", e?.message || e);
      }
    })();

    return message;
  }

  editMessage(groupId, username, timestamp, newText) {
    // Search within latest window and overlay changes
    const list = this._getGroupStreamWindowSync(groupId, MAX_GROUP_MESSAGES);
    const idx = (list || []).findIndex(
      (msg) => msg.username === username && msg.timestamp === timestamp
    );

    if (idx !== -1) {
      const now = new Date().toISOString();
      const current = list[idx];
      const historyEntry = {
        previousText: current.text,
        editedAt: now,
      };
      const edits = Array.isArray(current.edits) ? current.edits.slice() : [];
      edits.push(historyEntry);
      (async () => {
        try {
          await storage.overlaySet(groupId, current.messageId, {
            text: newText,
            edits,
            lastEditedAt: now,
            edited: true,
          });
        } catch (e) {
          console.error("overlaySet failed:", e?.message || e);
        }
      })();
      return { success: true, lastEditedAt: now };
    }
    return { success: false };
  }

  deleteMessage(groupId, username, timestamp) {
    const list = this._getGroupStreamWindowSync(groupId, MAX_GROUP_MESSAGES);
    const idx = (list || []).findIndex(
      (msg) => msg.username === username && msg.timestamp === timestamp
    );

    if (idx !== -1) {
      const now = new Date().toISOString();
      const current = list[idx];
      (async () => {
        try {
          await storage.overlaySet(groupId, current.messageId, {
            deleted: true,
            deletedAt: now,
            text: "",
          });
        } catch (e) {
          console.error("overlaySet failed:", e?.message || e);
        }
      })();
      return { success: true, deletedAt: now };
    }
    return { success: false };
  }

  deleteMessageById(groupId, messageId) {
    const list = this._getGroupStreamWindowSync(groupId, MAX_GROUP_MESSAGES);
    const target = (list || []).find((m) => m.messageId === messageId);
    if (!target)
      return { success: false, error: "Message not found or expired" };
    const now = new Date().toISOString();
    (async () => {
      try {
        await storage.overlaySet(groupId, messageId, {
          deleted: true,
          deletedAt: now,
          text: "",
        });
      } catch (e) {
        console.error("overlaySet failed:", e?.message || e);
      }
    })();
    return { success: true, deletedAt: now };
  }

  updateUserBubbleColorInMessages(_groupId, _username, _bubbleColor) {
    // No-op; with Streams we don't rewrite history for bubble color.
    return false;
  }

  getMessageByTimestamp(groupId, timestamp) {
    if (!groupId || !timestamp) return null;
    const list = this._getGroupStreamWindowSync(groupId, MAX_GROUP_MESSAGES);
    return (list || []).find((m) => m.timestamp === timestamp) || null;
  }

  getMessageById(groupId, messageId) {
    if (!groupId || !messageId) return null;
    const list = this._getGroupStreamWindowSync(groupId, MAX_GROUP_MESSAGES);
    return (list || []).find((m) => m.messageId === messageId) || null;
  }

  editMessageById(groupId, messageId, newText) {
    const list = this._getGroupStreamWindowSync(groupId, MAX_GROUP_MESSAGES);
    const idx = (list || []).findIndex((m) => m.messageId === messageId);
    if (idx !== -1) {
      const now = new Date().toISOString();
      const current = list[idx];
      const historyEntry = {
        previousText: current.text,
        editedAt: now,
      };
      const edits = Array.isArray(current.edits) ? current.edits.slice() : [];
      edits.push(historyEntry);
      (async () => {
        try {
          await storage.overlaySet(groupId, messageId, {
            text: newText,
            edits,
            lastEditedAt: now,
            edited: true,
          });
        } catch (e) {
          console.error("overlaySet failed:", e?.message || e);
        }
      })();
      return { success: true, lastEditedAt: now };
    }
    return { success: false };
  }

  // NOTE: Legacy array-based deleteMessageById removed. Streams/overlay version above is authoritative.

  async page(groupId, { before, limit } = {}) {
    const { items, nextBefore } = await storage.xPage(groupId, {
      before,
      limit,
    });
    const ids = items.map((m) => m.messageId).filter(Boolean);
    const [overlays, reacts] = await Promise.all([
      storage.overlayGetMany(groupId, ids),
      storage.reactionsGetMany(groupId, ids),
    ]);
    const merged = items.map((m) => ({
      ...m,
      ...(overlays?.[m.messageId] || {}),
      reactions: reacts?.[m.messageId] || {},
    }));
    return { items: merged, nextBefore };
  }

  async streamMetrics(groupId) {
    const [length, ht] = await Promise.all([
      storage.xLen(groupId),
      storage.xHeadTail(groupId),
    ]);
    return {
      length,
      head: ht.head,
      tail: ht.tail,
      max: MAX_GROUP_MESSAGES,
    };
  }
  updateUserProfile(userId, { username, avatar }) {
    if (!userId) return false;
    let mutated = false;
    for (const [groupId, arr] of Object.entries(this.messagesByGroup)) {
      if (!Array.isArray(arr) || !arr.length) continue;
      let groupChanged = false;
      for (let i = 0; i < arr.length; i++) {
        const m = arr[i];
        if (m.userId && m.userId === userId) {
          const next = { ...m };
          if (username && username !== m.username) next.username = username;
          if (avatar !== undefined && avatar !== m.avatar) next.avatar = avatar;
          if (next !== m) {
            arr[i] = next;
            groupChanged = true;
          }
        }
      }
      if (groupChanged) mutated = true;
    }
    if (mutated) this.saveMessages();
    return mutated;
  }

  // Helper to compute summary from a reactions map
  summarizeReactions(reactions) {
    const entries = Object.values(reactions || {});
    const totalCount = entries.length;
    if (!totalCount) {
      return { totalCount: 0, mostRecent: null };
    }
    // Pick the max 'at'
    let most = entries[0];
    for (let i = 1; i < entries.length; i++) {
      if ((entries[i].at || 0) > (most.at || 0)) most = entries[i];
    }
    return {
      totalCount,
      mostRecent: {
        emoji: most.emoji,
        at: most.at,
        userId: most.userId,
        username: most.username,
      },
    };
  }

  // Ensure message has a reactions map
  ensureReactions(msg) {
    if (!msg.reactions || typeof msg.reactions !== "object") {
      msg.reactions = {};
    }
    return msg.reactions;
  }

  // Update (toggle) a reaction by messageId
  updateReactionById(groupId, messageId, { userId, username }, emoji) {
    const now = Date.now();
    const list = this._getGroupStreamWindowSync(groupId, MAX_GROUP_MESSAGES);
    const target = (list || []).find((m) => m.messageId === messageId);
    if (!target)
      return { success: false, error: "Message not found or expired" };
    return (async () => {
      try {
        const currentMap =
          (await storage.reactionsGetMany(groupId, [messageId]))[messageId] ||
          {};
        const reactions = { ...currentMap };
        const cur = reactions[userId]?.emoji;
        if (!emoji || cur === emoji) {
          if (reactions[userId]) delete reactions[userId];
        } else {
          reactions[userId] = { emoji, at: now, userId, username };
        }
        await storage.reactionsSet(groupId, messageId, reactions);
        return {
          success: true,
          reactions,
          summary: this.summarizeReactions(reactions),
          messageId,
          groupId,
        };
      } catch (e) {
        console.error("reactionsSet failed:", e?.message || e);
        return { success: false, error: "Failed to update reaction" };
      }
    })();
  }

  // Update (toggle) a reaction by timestamp (fallback)
  updateReactionByTimestamp(groupId, timestamp, user, emoji) {
    const list = this._getGroupStreamWindowSync(groupId, MAX_GROUP_MESSAGES);
    const target = (list || []).find((m) => m.timestamp === timestamp);
    if (!target)
      return { success: false, error: "Message not found or expired" };
    return this.updateReactionById(groupId, target.messageId, user, emoji);
  }

  // Internal: fetch latest N from stream and merge overlays/reactions; cached synchronously
  _getGroupStreamWindowSync(groupId, n) {
    this._lastWindows = this._lastWindows || new Map();
    // async refresh
    (async () => {
      try {
        const list = await storage.xRangeLatest(groupId, n, { reverse: true });
        const ids = list.map((m) => m.messageId).filter(Boolean);
        const overlays = await storage.overlayGetMany(groupId, ids);
        const reacts = await storage.reactionsGetMany(groupId, ids);
        const merged = list.map((m) => ({
          ...m,
          ...(overlays?.[m.messageId] || {}),
          reactions: reacts?.[m.messageId] || {},
        }));
        this._lastWindows.set(groupId, merged);
      } catch (e) {
        // non-fatal
      }
    })();
    return this._lastWindows.get(groupId) || [];
  }
}

module.exports = new MessageModel();
