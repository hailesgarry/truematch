const messageController = require("../lib/pyAdapter");
const py = require("../lib/pyClient");
const userController = require("../controllers/userController");

const GRACE_MS = 5000;
const AGGREGATION_WINDOW_MS = 5000;
const INACTIVITY_MS = 5_000;
const INACTIVITY_CHECK_MS = 1_000;
const DEFAULT_HISTORY_WINDOW = Number(process.env.GROUP_MESSAGE_MAX || 100);

const lastActiveByUser = new Map();
const activeUsers = new Set();
const pendingDisconnectByUser = new Map();
const aggregationState = {
  join: new Map(),
  leave: new Map(),
};

let ioInstance = null;
let inactivitySweepTimer = null;

function initSharedState(io) {
  if (!io) return;
  ioInstance = io;
  if (!inactivitySweepTimer) {
    inactivitySweepTimer = setInterval(runInactivitySweep, INACTIVITY_CHECK_MS);
  }
}

function getIoInstance() {
  return ioInstance;
}

function runInactivitySweep() {
  const now = Date.now();
  for (const usernameLc of Array.from(activeUsers)) {
    const last = lastActiveByUser.get(usernameLc) || 0;
    if (now - last > INACTIVITY_MS) {
      activeUsers.delete(usernameLc);
      const at = Date.now();
      lastActiveByUser.set(usernameLc, at);
      if (ioInstance) {
        ioInstance.emit("presence:offline", { username: usernameLc, at });
      }
    }
  }
}

function getSocketIdsForUsername(io, usernameLc) {
  if (!io || !usernameLc) return [];
  const ids = [];
  for (const [sid] of io.sockets.sockets) {
    const user = userController.getUser(sid);
    if (
      user &&
      !user.pendingDisconnect &&
      typeof user.username === "string" &&
      user.username.toLowerCase() === usernameLc
    ) {
      ids.push(sid);
    }
  }
  return ids;
}

async function buildProfileSummaryForLike(username) {
  try {
    const profile = await py.getProfile(username);
    if (!profile) return { username: String(username || "") };
    const primaryPhoto =
      (Array.isArray(profile.photos) && profile.photos[0]) ||
      profile.photoUrl ||
      null;
    return {
      username: profile.username,
      age: profile.age,
      gender: profile.gender,
      mood: profile.mood,
      photoUrl: primaryPhoto,
      location: profile.location
        ? {
            city: profile.location.city,
            state: profile.location.state,
            formatted: profile.location.formatted,
          }
        : undefined,
    };
  } catch {
    return { username: String(username || "") };
  }
}

function sanitizeDatingProfilePayload(profile) {
  if (!profile || typeof profile !== "object") return null;
  try {
    return JSON.parse(JSON.stringify(profile));
  } catch (e) {
    const safe = {};
    for (const key of Object.keys(profile)) {
      const value = profile[key];
      if (
        value == null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        safe[key] = value;
      } else if (Array.isArray(value)) {
        safe[key] = value
          .map((item) => {
            if (
              item == null ||
              typeof item === "string" ||
              typeof item === "number" ||
              typeof item === "boolean"
            ) {
              return item;
            }
            if (item && typeof item === "object") {
              try {
                return JSON.parse(JSON.stringify(item));
              } catch {
                return null;
              }
            }
            return null;
          })
          .filter((entry) => entry !== undefined);
      } else if (value && typeof value === "object") {
        try {
          safe[key] = JSON.parse(JSON.stringify(value));
        } catch {
          safe[key] = null;
        }
      }
    }
    return safe;
  }
}

function broadcastPresenceOnline(io, username) {
  if (!username) return;
  const targetIo = io || ioInstance;
  if (!targetIo) return;
  const normalized = String(username).toLowerCase();
  lastActiveByUser.set(normalized, Date.now());
  if (!activeUsers.has(normalized)) {
    activeUsers.add(normalized);
    targetIo.emit("presence:online", {
      username: normalized,
      at: lastActiveByUser.get(normalized),
    });
  }
}

function broadcastPresenceOffline(io, username) {
  if (!username) return;
  const targetIo = io || ioInstance;
  if (!targetIo) return;
  const normalized = String(username).toLowerCase();
  const others = (userController.getAllUsers() || []).some(
    (usr) =>
      !usr.pendingDisconnect &&
      typeof usr.username === "string" &&
      usr.username.toLowerCase() === normalized
  );
  if (others) return;
  if (activeUsers.has(normalized)) {
    activeUsers.delete(normalized);
    const at = Date.now();
    lastActiveByUser.set(normalized, at);
    targetIo.emit("presence:offline", { username: normalized, at });
  }
}

function formatNamesForSystem(names) {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  const head = names.slice(0, names.length - 1).join(", ");
  return `${head} and ${names[names.length - 1]}`;
}

function emitSystemMessage(io, groupId, text) {
  const targetIo = io || ioInstance;
  if (!targetIo) return;
  const optimistic = {
    messageId: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    username: "system",
    text,
    system: true,
    timestamp: new Date().toISOString(),
    createdAt: Date.now(),
    _optimistic: true,
  };
  targetIo.to(groupId).emit("message", { groupId, message: optimistic });
  const start = Date.now();
  Promise.resolve()
    .then(() => messageController.createMessage(groupId, optimistic))
    .then((real) => {
      if (!real || !real.messageId) return;
      if (real.messageId !== optimistic.messageId) {
        targetIo.to(groupId).emit("message-reconcile", {
          groupId,
          optimisticId: optimistic.messageId,
          realId: real.messageId,
          message: real,
          latencyMs: Date.now() - start,
        });
      }
    })
    .catch((e) => {
      console.warn(
        "emitSystemMessage persistence failed:",
        e?.code || e?.message || e
      );
    });
}

function queueAggregatedSystem(io, groupId, kind, username) {
  if (!groupId || !kind || !username) return;
  const map = aggregationState[kind];
  if (!map) return;
  let entry = map.get(groupId);
  if (!entry) {
    entry = { users: new Set(), timer: null };
    map.set(groupId, entry);
  }
  entry.users.add(username);
  if (!entry.timer) {
    entry.timer = setTimeout(async () => {
      try {
        const users = Array.from(entry.users);
        map.delete(groupId);
        if (!users.length) return;
        const names = users;
        const verb = kind === "join" ? "joined" : "left";
        const text =
          names.length === 1
            ? `${names[0]} ${verb}`
            : `${formatNamesForSystem(names)} ${verb}`;
        await emitSystemMessage(io, groupId, text);
      } catch (e) {
        console.error("flush aggregated system failed:", e);
      }
    }, AGGREGATION_WINDOW_MS);
  }
}

function dmParticipants(dmId) {
  if (typeof dmId !== "string") return [];
  const rest = dmId.startsWith("dm:") ? dmId.slice(3) : dmId;
  const parts = rest
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length !== 2) return [];
  return parts.map((s) => s.toLowerCase()).sort();
}

function isValidDmId(dmId) {
  const parts = dmParticipants(dmId);
  return parts.length === 2 && parts[0] !== parts[1];
}

function userInDm(dmId, username) {
  if (!username) return false;
  const u = String(username).toLowerCase();
  const parts = dmParticipants(dmId);
  return parts.includes(u);
}

function normalizeUsernameValue(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isSystemLikeMessage(msg) {
  if (!msg || typeof msg !== "object") return false;
  if (msg.system === true) return true;
  if (typeof msg.systemType === "string" && msg.systemType.trim()) return true;
  if (typeof msg.type === "string" && msg.type.toLowerCase().includes("system"))
    return true;
  const uname = normalizeUsernameValue(msg.username);
  return uname === "system" || uname === "_system";
}

function normalizeScopeId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function coerceTimestampToMs(value) {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.getTime();
  }
  if (typeof value === "string") {
    const num = Number(value);
    if (Number.isFinite(num)) {
      return num < 1e12 ? Math.round(num * 1000) : Math.round(num);
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function buildFilterMap(items) {
  const map = Object.create(null);
  if (!Array.isArray(items)) return map;
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const groupId = normalizeScopeId(raw.groupId || raw.roomId || raw.dmId);
    const normalized = normalizeUsernameValue(
      typeof raw.normalized === "string" && raw.normalized
        ? raw.normalized
        : raw.username
    );
    if (!groupId || !normalized) continue;
    const createdAt = coerceTimestampToMs(raw.createdAt);
    if (!map[groupId] || typeof map[groupId] !== "object") {
      map[groupId] = Object.create(null);
    }
    map[groupId][normalized] = {
      createdAt,
    };
  }
  return map;
}

function ensureBucketObject(bucket, scopeId, source) {
  if (!bucket || typeof bucket !== "object") return bucket;
  if (!Array.isArray(bucket)) return bucket;
  const obj = Object.create(null);
  for (const entry of bucket) {
    if (!entry) continue;
    const normalized = normalizeUsernameValue(
      entry.username || entry.normalized
    );
    if (!normalized) continue;
    const createdAt = coerceTimestampToMs(entry.createdAt);
    obj[normalized] = { createdAt };
  }
  source[scopeId] = obj;
  return obj;
}

function getFilterBucket(filtersByGroup, scopeId) {
  if (!filtersByGroup || !scopeId) return null;
  if (filtersByGroup instanceof Map) return filtersByGroup.get(scopeId) || null;
  const entry = filtersByGroup[scopeId];
  if (!entry) return null;
  if (entry instanceof Map) return entry;
  if (Array.isArray(entry))
    return ensureBucketObject(entry, scopeId, filtersByGroup);
  if (typeof entry === "object") return entry;
  return null;
}

function getFilterEntry(bucket, normalized) {
  if (!bucket || !normalized) return null;
  if (bucket instanceof Map) return bucket.get(normalized) || null;
  if (typeof bucket === "object") return bucket[normalized] || null;
  return null;
}

function extractTimestampMs(message) {
  if (!message || typeof message !== "object") return null;
  const candidates = [
    message.timestamp,
    message.createdAt,
    message.created_at,
    message.sentAt,
    message.sent_at,
  ];
  for (const value of candidates) {
    const ms = coerceTimestampToMs(value);
    if (ms != null) return ms;
  }
  return null;
}

function filterMessagesForScope(messages, filterBucket) {
  if (!Array.isArray(messages)) return [];
  if (!filterBucket) return messages;
  const hasEntries =
    filterBucket instanceof Map
      ? filterBucket.size > 0
      : Object.keys(filterBucket).length > 0;
  if (!hasEntries) return messages;
  return messages.filter((msg) => {
    if (!msg || typeof msg !== "object") return false;
    if (isSystemLikeMessage(msg)) return true;
    const uname = normalizeUsernameValue(msg.username || msg.user);
    if (!uname) return true;
    const entry = getFilterEntry(filterBucket, uname);
    if (!entry) return true;
    const since = coerceTimestampToMs(entry.createdAt);
    if (since == null) return false;
    const ts = extractTimestampMs(msg);
    if (ts == null) return false;
    return ts < since;
  });
}

function shouldSkipForUser(user, scopeId, authorNormalized, timestamp) {
  if (!user || !scopeId || !authorNormalized) return false;
  if (user.pendingDisconnect) return true;
  const mine = normalizeUsernameValue(user.username);
  if (mine && mine === authorNormalized) return false;
  const bucket = getFilterBucket(user.filtersByGroup, scopeId);
  if (!bucket) return false;
  const entry = getFilterEntry(bucket, authorNormalized);
  if (!entry) return false;
  const since = coerceTimestampToMs(entry.createdAt);
  if (since == null) return true;
  const ts = coerceTimestampToMs(timestamp);
  if (ts == null) return true;
  return ts >= since;
}

function emitToRoomRespectingFilters(io, roomId, event, payload, options = {}) {
  if (!io || !roomId || !event) return;
  const { authorUsername, timestamp, message } = options;
  const normalizedAuthor = normalizeUsernameValue(authorUsername);
  const resolvedTimestamp =
    timestamp != null
      ? coerceTimestampToMs(timestamp)
      : extractTimestampMs(message);
  const room = io.sockets?.adapter?.rooms?.get(roomId);
  if (!room || !room.size) return;
  for (const socketId of room) {
    const targetSocket = io.sockets?.sockets?.get(socketId);
    if (!targetSocket) continue;
    const targetUser = userController.getUser(socketId);
    if (!targetUser || targetUser.pendingDisconnect) continue;
    if (
      normalizedAuthor &&
      shouldSkipForUser(targetUser, roomId, normalizedAuthor, resolvedTimestamp)
    ) {
      continue;
    }
    targetSocket.emit(event, payload);
  }
}

function emitToSocketIdsRespectingFilters(
  io,
  socketIds,
  scopeId,
  event,
  payload,
  options = {}
) {
  if (!io || !Array.isArray(socketIds) || !event) return;
  const { authorUsername, timestamp, message } = options;
  const normalizedAuthor = normalizeUsernameValue(authorUsername);
  const resolvedTimestamp =
    timestamp != null
      ? coerceTimestampToMs(timestamp)
      : extractTimestampMs(message);
  for (const socketId of socketIds) {
    const targetSocket = io.sockets?.sockets?.get(socketId);
    if (!targetSocket) continue;
    const targetUser = userController.getUser(socketId);
    if (!targetUser || targetUser.pendingDisconnect) continue;
    if (
      normalizedAuthor &&
      scopeId &&
      shouldSkipForUser(
        targetUser,
        scopeId,
        normalizedAuthor,
        resolvedTimestamp
      )
    ) {
      continue;
    }
    targetSocket.emit(event, payload);
  }
}

async function refreshUserFilters(socket, user, emitSnapshot = true) {
  if (!socket || !user || !user.userId) {
    const existing = user?.filtersByGroup || {};
    return { items: [], map: existing };
  }
  try {
    const data = await messageController.getMessageFiltersForUser(user.userId);
    const items = Array.isArray(data?.items) ? data.items : [];
    const map = buildFilterMap(items);
    userController.updateUser(socket.id, {
      filtersByGroup: map,
      filtersFetchedAt: Date.now(),
    });
    if (emitSnapshot) {
      socket.emit("filters:snapshot", {
        userId: data?.userId || user.userId,
        items,
        groups:
          data?.groups && typeof data.groups === "object" ? data.groups : {},
      });
    }
    return { items, map };
  } catch (e) {
    console.warn("refreshUserFilters failed", e?.message || e);
    const existing = user?.filtersByGroup || {};
    return { items: [], map: existing };
  }
}

async function loadLatestHistory(scopeId) {
  const limit = DEFAULT_HISTORY_WINDOW;
  try {
    const messages = await messageController.getLatestWindow(scopeId, limit);
    if (Array.isArray(messages)) return messages;
  } catch (e) {}
  const fallback = messageController.getMessages(scopeId);
  return Array.isArray(fallback) ? fallback : [];
}

function markActive(io, username) {
  if (!username) return;
  const targetIo = io || ioInstance;
  const normalized = String(username).toLowerCase();
  const now = Date.now();
  lastActiveByUser.set(normalized, now);
  if (!activeUsers.has(normalized)) {
    activeUsers.add(normalized);
    if (targetIo) {
      targetIo.emit("presence:online", { username: normalized, at: now });
    }
  }
}

function buildOnlineCounts() {
  return userController.getOnlineCounts();
}

function broadcastOnlineCounts(io) {
  if (!io) return;
  io.emit("online-counts", buildOnlineCounts());
}

function sendPresenceSnapshot(socket) {
  const last = {};
  for (const [u, t] of lastActiveByUser.entries()) {
    last[u] = t;
  }
  socket.emit("presence:snapshot", {
    users: Array.from(activeUsers),
    lastActive: last,
  });
}

function cloudEnabled() {
  return false;
}

async function uploadDataUrl() {
  throw new Error("Cloudinary disabled in node-service");
}

async function saveDataUrlToChatFile(socket, username, dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const m = dataUrl.match(
    /^data:((?:image|video)\/[a-z0-9+\-.]+);base64,([a-z0-9+/=]+)$/i
  );
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const extMap = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "video/ogg": ".ogv",
  };
  const fallback = mime.startsWith("video/") ? ".mp4" : ".png";
  const ext = extMap[mime] || fallback;
  try {
    if (cloudEnabled()) {
      const folder = process.env.CLOUDINARY_CHAT_FOLDER || "funly/chat";
      const url = await uploadDataUrl(dataUrl, {
        folder,
        resourceType: mime.startsWith("video/") ? "video" : "image",
      });
      if (url) return url;
    }
  } catch (e) {}
  return null;
}

async function normalizeUrlLike(socket, username, value, isPreview = false) {
  if (value == null) return value;
  const val = String(value).trim();
  if (!val) return val;
  if (/^https?:\/\//i.test(val)) return val;
  if (/^data:(?:image|video)\//i.test(val)) {
    const url = await saveDataUrlToChatFile(socket, username, val);
    return url || val;
  }
  if (val.startsWith("/uploads/")) return val;
  if (val.startsWith("uploads/")) return val;
  return val;
}

async function normalizeMediaForMessage(socket, username, media) {
  if (!media) return undefined;
  if (typeof media === "string") {
    const original = await normalizeUrlLike(socket, username, media);
    return { original };
  }
  const out = {};
  const fields = ["original", "preview", "gif", "thumbnail"];
  for (const key of fields) {
    const val = media[key];
    if (val === undefined) continue;
    out[key] = await normalizeUrlLike(
      socket,
      username,
      val,
      key !== "original"
    );
  }
  const originUrl = typeof out.original === "string" ? out.original : undefined;
  for (const key of ["preview", "gif", "thumbnail"]) {
    const v = out[key];
    if (typeof v === "string" && /^data:/i.test(v)) {
      if (originUrl) {
        out[key] = originUrl;
      } else {
        delete out[key];
      }
    }
  }
  if (media.type) out.type = media.type;
  return out;
}

async function normalizeAvatarToUrl(socket, username, avatar) {
  if (avatar === undefined) return undefined;
  const val = String(avatar || "").trim();
  if (!val) return null;
  if (/^https?:\/\//i.test(val)) return val;
  if (/^data:image\//i.test(val)) {
    if (cloudEnabled()) {
      try {
        const url = await uploadDataUrl(val, {
          folder: process.env.CLOUDINARY_AVATAR_FOLDER || "funly/avatars",
          resourceType: "image",
        });
        if (url) return url;
      } catch {}
    }
    return val;
  }
  if (val.startsWith("/uploads/")) return val;
  if (val.startsWith("uploads/")) return val;
  return null;
}

module.exports = {
  messageController,
  py,
  userController,
  GRACE_MS,
  AGGREGATION_WINDOW_MS,
  INACTIVITY_MS,
  INACTIVITY_CHECK_MS,
  DEFAULT_HISTORY_WINDOW,
  lastActiveByUser,
  activeUsers,
  pendingDisconnectByUser,
  aggregationState,
  initSharedState,
  getIoInstance,
  getSocketIdsForUsername,
  buildProfileSummaryForLike,
  sanitizeDatingProfilePayload,
  broadcastPresenceOnline,
  broadcastPresenceOffline,
  queueAggregatedSystem,
  dmParticipants,
  isValidDmId,
  userInDm,
  refreshUserFilters,
  loadLatestHistory,
  getFilterBucket,
  filterMessagesForScope,
  emitToRoomRespectingFilters,
  emitToSocketIdsRespectingFilters,
  normalizeMediaForMessage,
  normalizeAvatarToUrl,
  markActive,
  broadcastOnlineCounts,
  sendPresenceSnapshot,
};
