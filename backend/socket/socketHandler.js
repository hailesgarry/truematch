const messageController = require("../controllers/messageController");
const userController = require("../controllers/userController");
const groupController = require("../controllers/groupController");
const datingModel = require("../models/dating"); // NEW

// No local filesystem backups; Cloudinary handles media storage

// =========================
// ADD: Constants
// =========================

const GRACE_MS = 3000;
const AGGREGATION_WINDOW_MS = 5000;

// ADD: inactivity constants (5s for testing; change to 30 * 60 * 1000 later)
const INACTIVITY_MS = 5_000; // TEST value; set to 1_800_000 for 30 min
const INACTIVITY_CHECK_MS = 1_000; // how often we sweep

// Removed local upload directories; no filesystem writes

// =========================
// ADD: Helpers (missing)
// =========================

// Resolve all socket IDs for a given username (lower-cased)
function getSocketIdsForUsername(io, usernameLc) {
  if (!io || !usernameLc) return [];
  const ids = [];
  // io.sockets.sockets is a Map<socketId, Socket>
  for (const [sid] of io.sockets.sockets) {
    const u = userController.getUser(sid);
    if (
      u &&
      !u.pendingDisconnect &&
      typeof u.username === "string" &&
      u.username.toLowerCase() === usernameLc
    ) {
      ids.push(sid);
    }
  }
  return ids;
}

// Build a safe, compact profile summary to send in a like notification
function buildProfileSummaryForLike(username) {
  const profile = datingModel.getByUsername(username);
  if (!profile) {
    return { username: String(username || "") };
  }
  const primaryPhoto =
    (Array.isArray(profile.photos) && profile.photos[0]) ||
    profile.photoUrl ||
    null; // avoid sending large base64 "photo" over socket

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
}

// =========================
// ADD: Helpers (missing)
// =========================

// Presence broadcast helpers
function broadcastPresenceOnline(io, username) {
  if (!username) return;
  const u = String(username).toLowerCase();
  lastActiveByUser.set(u, Date.now());
  if (!activeUsers.has(u)) {
    activeUsers.add(u);
    io.emit("presence:online", { username: u, at: lastActiveByUser.get(u) });
  }
}

function broadcastPresenceOffline(io, username, userController) {
  if (!username) return;
  const u = String(username).toLowerCase();
  // Only go offline if there are no other active sockets for this username
  const others = (userController.getAllUsers() || []).some(
    (usr) =>
      !usr.pendingDisconnect &&
      typeof usr.username === "string" &&
      usr.username.toLowerCase() === u
  );
  if (others) return; // still online somewhere else

  if (activeUsers.has(u)) {
    activeUsers.delete(u);
    // Use the actual moment we mark them offline, not the last activity ping
    const at = Date.now();
    lastActiveByUser.set(u, at);
    io.emit("presence:offline", { username: u, at });
  }
}

// System message aggregation (join/leave)
function formatNamesForSystem(names) {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  const head = names.slice(0, names.length - 1).join(", ");
  return `${head} and ${names[names.length - 1]}`;
}

function emitSystemMessage(io, groupId, text) {
  try {
    const message = messageController.createMessage(groupId, {
      username: "system",
      text,
      system: true,
    });
    io.to(groupId).emit("message", { groupId, message });
  } catch (e) {
    console.error("emitSystemMessage failed:", e);
  }
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
    entry.timer = setTimeout(() => {
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
        emitSystemMessage(io, groupId, text);
      } catch (e) {
        console.error("flush aggregated system failed:", e);
      }
    }, AGGREGATION_WINDOW_MS);
  }
}

// DM helpers for "dm:alice|bob"
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
// =========================

const lastActiveByUser = new Map(); // userLc -> ms
const activeUsers = new Set(); // userLc set that we’ve broadcast as "online"

// Helper: normalize username and mark active
function markActive(io, username) {
  if (!username) return;
  const u = String(username).toLowerCase();
  lastActiveByUser.set(u, Date.now());
  if (!activeUsers.has(u)) {
    activeUsers.add(u);
    io.emit("presence:online", { username: u, at: lastActiveByUser.get(u) });
  }
}

// Sweep inactive → offline
setInterval(() => {
  const now = Date.now();
  for (const u of Array.from(activeUsers)) {
    const last = lastActiveByUser.get(u) || 0;
    if (now - last > INACTIVITY_MS) {
      activeUsers.delete(u);
      // Mark offline at the detection time for clearer UX
      const at = Date.now();
      lastActiveByUser.set(u, at);
      ioInstance?.emit("presence:offline", { username: u, at });
    }
  }
}, INACTIVITY_CHECK_MS);

// Keep a module-local reference for the sweeper to emit
let ioInstance = null;

// Existing online counts helpers...
function buildOnlineCounts(userController) {
  return userController.getOnlineCounts();
}
function broadcastOnlineCounts(io, userController) {
  io.emit("online-counts", buildOnlineCounts(userController));
}

// UPDATED: presence snapshot -> send currently active users
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

// (existing aggregation helpers stay unchanged)

// Update existing setupSocket to initialize ioInstance and wire new events
function setupSocket(io) {
  ioInstance = io;
  io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    // Send presence snapshot (active users)
    sendPresenceSnapshot(socket);

    // NEW: generic presence ping from client for activity/heartbeat
    socket.on("presence:ping", () => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) return;
      markActive(io, user.username);
    });

    // JOIN (group) — touch activity when a user successfully joins/updates
    socket.on("join", async (data = {}) => {
      const { userId, username } = data;
      // Normalize avatar to URL
      const normalizedAvatar = await normalizeAvatarToUrl(
        socket,
        username,
        data.avatar
      );

      if (!userId || !username || !data.groupId) {
        socket.emit("error", {
          message: "userId, username and groupId are required",
        });
        return;
      }

      const groupInfo = groupController.getGroup(data.groupId);
      if (!groupInfo) {
        socket.emit("error", { message: "Group not found" });
        return;
      }

      const existing = userController.getUser(socket.id);
      let isFirstJoinToGroup = false;

      if (existing) {
        const wasInGroup = existing.groups.includes(data.groupId);
        if (!wasInGroup) {
          socket.join(data.groupId);
          existing.groups.push(data.groupId);
          isFirstJoinToGroup = true;
        } else {
          const rooms = socket.rooms;
          if (!rooms.has(data.groupId)) socket.join(data.groupId);
        }
        existing.activeGroupId = data.groupId;
        userController.updateUser(socket.id, {
          avatar: normalizedAvatar ?? null,
          ...(data.bubbleColor ? { bubbleColor: data.bubbleColor } : {}),
          groups: existing.groups,
          activeGroupId: data.groupId,
          pendingDisconnect: false,
          disconnectAt: null,
        });
      } else {
        userController.addUser(socket.id, {
          userId,
          username,
          avatar: normalizedAvatar ?? null,
          ...(data.bubbleColor ? { bubbleColor: data.bubbleColor } : {}),
          groups: [data.groupId],
          activeGroupId: data.groupId,
          pendingDisconnect: false,
          disconnectAt: null,
          _graceTimer: null,
        });
        socket.join(data.groupId);
        isFirstJoinToGroup = true;
      }

      // Only update historical messages if a custom color is explicitly set
      if (data.bubbleColor) {
        messageController.updateUserBubbleColor(
          data.groupId,
          username,
          data.bubbleColor
        );
      }

      try {
        const messages = await messageController.getLatestWindow(
          data.groupId,
          Number(process.env.GROUP_MESSAGE_MAX || 100)
        );
        socket.emit("message-history", { groupId: data.groupId, messages });
      } catch (e) {
        // fallback to legacy snapshot
        socket.emit("message-history", {
          groupId: data.groupId,
          messages: messageController.getMessages(data.groupId),
        });
      }
      // Also send participants' current avatars (from live users or last message fallback)
      try {
        const parts = dmParticipants(data.groupId); // ['alice','bob'] lowercased
        const list =
          (await messageController.getLatestWindow(
            data.groupId,
            Number(process.env.GROUP_MESSAGE_MAX || 100)
          )) || [];
        const allUsers = userController.getAllUsers() || [];
        const participants = parts.map((lc) => {
          // Find live user record first
          const live = allUsers.find(
            (u) =>
              u &&
              typeof u.username === "string" &&
              u.username.toLowerCase() === lc
          );
          let username = live?.username || lc;
          let avatar = live?.avatar || null;
          // Fallback to last message by that user for avatar/casing
          if (!avatar) {
            for (let i = list.length - 1; i >= 0; i--) {
              const m = list[i];
              if (
                m &&
                typeof m.username === "string" &&
                m.username.toLowerCase() === lc
              ) {
                username = m.username || username;
                avatar = m.avatar || avatar;
                break;
              }
            }
          }
          return { username, avatar: avatar ?? null };
        });
        socket.emit("dm:participants", { dmId: data.groupId, participants });
      } catch (e) {
        // non-fatal
        console.warn("dm:participants emit failed:", e?.message || e);
      }

      const list = userController.getUsersByGroup(data.groupId);
      io.to(data.groupId).emit("user-list", {
        groupId: data.groupId,
        users: list,
      });

      // ADD: compute grace rejoin flag to avoid duplicate join system messages
      const isRejoinWithinGrace =
        !!existing &&
        !!existing.pendingDisconnect &&
        typeof existing.disconnectAt === "number" &&
        Date.now() - existing.disconnectAt <= GRACE_MS;

      if (!isRejoinWithinGrace) {
        socket
          .to(data.groupId)
          .emit("user-joined", { groupId: data.groupId, username });

        // UPDATED: queue system join (aggregated) instead of immediate
        if (isFirstJoinToGroup) {
          queueAggregatedSystem(io, data.groupId, "join", username);
        }
      }

      broadcastOnlineCounts(io, userController);
      broadcastPresenceOnline(io, username);
    });

    // UPDATE bubble color unchanged...
    socket.on("update-bubble-color", (color) => {
      const user = userController.getUser(socket.id);
      if (!user) return;
      userController.updateUser(socket.id, { bubbleColor: color });
      (user.groups || []).forEach((g) => {
        messageController.updateUserBubbleColor(g, user.username, color);
        const userList = userController.getUsersByGroup(g);
        io.to(g).emit("user-list", { groupId: g, users: userList });
        io.to(g).emit("user-color-change", {
          groupId: g,
          username: user.username,
          bubbleColor: color,
        });
      });
    });

    // MESSAGE event (updated to support media normalization)
    socket.on("message", async (rawPayload, legacyReplyData) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "You must join a group first" });
        return;
      }

      // Extract fields
      let groupId, text, replyToMessageId, replyToTimestamp, kind, media;
      if (typeof rawPayload === "string") {
        // legacy string payload
        groupId = user.activeGroupId;
        text = rawPayload;
        if (legacyReplyData?.messageId)
          replyToMessageId = legacyReplyData.messageId;
        else if (legacyReplyData?.timestamp)
          replyToTimestamp = legacyReplyData.timestamp;
      } else {
        groupId = rawPayload?.groupId || user.activeGroupId;
        text = rawPayload?.text;
        replyToMessageId =
          rawPayload?.replyToMessageId ||
          rawPayload?.replyTo?.messageId ||
          legacyReplyData?.messageId ||
          null;
        replyToTimestamp =
          rawPayload?.replyToTimestamp ||
          rawPayload?.replyTo?.timestamp ||
          legacyReplyData?.timestamp ||
          null;

        // NEW: accept structured media (same shape used in DMs)
        kind = rawPayload?.kind;
        media = rawPayload?.media;
      }

      if (!groupId || !text || !user.groups.includes(groupId)) {
        socket.emit("error", { message: "Invalid group or not a member" });
        return;
      }

      // Normalize media (convert data URLs -> saved files -> absolute URLs)
      let normalizedMedia = undefined;
      if (media) {
        normalizedMedia = await normalizeMediaForMessage(
          socket,
          user.username,
          media
        );
      }

      // Build message data
      const messageData = {
        messageId: undefined,
        userId: user.userId,
        username: user.username,
        avatar: user.avatar,
        bubbleColor: user.bubbleColor,
        text: String(text),
        ...(kind ? { kind } : {}),
        ...(normalizedMedia ? { media: normalizedMedia } : {}),
      };

      // Resolve reply target if provided and include media/kind for preview
      let original = null;
      if (replyToMessageId) {
        original = messageController.getMessageById(groupId, replyToMessageId);
        // Fallback: fetch latest window if not found in cache
        if (!original) {
          try {
            const messages = await messageController.getLatestWindow(
              groupId,
              Number(process.env.GROUP_MESSAGE_MAX || 100)
            );
            original = (messages || []).find(
              (m) => m.messageId === replyToMessageId
            );
          } catch {}
        }
      } else if (replyToTimestamp) {
        original = messageController.getMessageByTimestamp(
          groupId,
          replyToTimestamp
        );
        if (!original) {
          try {
            const messages = await messageController.getLatestWindow(
              groupId,
              Number(process.env.GROUP_MESSAGE_MAX || 100)
            );
            original = (messages || []).find(
              (m) => m.timestamp === replyToTimestamp
            );
          } catch {}
        }
      }
      if (original) {
        messageData.replyTo = {
          messageId: original.messageId,
          username: original.username,
          text: original.text,
          timestamp: original.timestamp,
          // NEW: enrich reply preview with media/kind if present
          ...(original.kind ? { kind: original.kind } : {}),
          ...(original.media ? { media: original.media } : {}),
        };
      } else if (replyToMessageId || replyToTimestamp) {
        socket.emit("reply-warn", {
          warning: "Original message not found",
          replyToMessageId,
          replyToTimestamp,
        });
      }

      const message = messageController.createMessage(groupId, messageData);
      io.to(groupId).emit("message", { groupId, message });

      // touch activity
      if (user?.username) markActive(io, user.username);
    });

    // LEAVE event (single group)
    socket.on("leave", ({ groupId } = {}) => {
      if (!groupId) return;
      const user = userController.getUser(socket.id);
      if (!user || !user.groups.includes(groupId)) return;

      const leavingUsername = user.username;

      socket.leave(groupId);
      socket
        .to(groupId)
        .emit("user-left", { groupId, username: leavingUsername });

      const newGroups = user.groups.filter((g) => g !== groupId);
      let activeGroupId = user.activeGroupId;
      if (activeGroupId === groupId) {
        activeGroupId = newGroups[0] || null;
      }

      if (newGroups.length === 0) {
        userController.removeUser(socket.id);
      } else {
        userController.updateUser(socket.id, {
          groups: newGroups,
          activeGroupId,
        });
      }

      const list = userController.getUsersByGroup(groupId);
      io.to(groupId).emit("user-list", { groupId, users: list });

      // UPDATED: queue aggregated leave system message
      queueAggregatedSystem(io, groupId, "leave", leavingUsername);

      broadcastOnlineCounts(io, userController);
      broadcastPresenceOffline(io, leavingUsername, userController);
    });

    // EDIT / DELETE handlers unchanged ...

    socket.on("edit-message", async (payload) => {
      // unchanged edit logic...
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "You must join a group first" });
        return;
      }
      const {
        messageId,
        groupId: providedGroupId,
        timestamp,
        newText,
      } = payload || {};
      const groupId = providedGroupId || user.activeGroupId;
      const dmAllowed =
        groupId &&
        groupId.startsWith("dm:") &&
        userInDm(groupId, user.username);
      if (
        !groupId ||
        (!dmAllowed && !user.groups.includes(groupId)) ||
        !newText
      ) {
        socket.emit("edit-error", { error: "Invalid data" });
        return;
      }
      let target = null;
      if (messageId) {
        target = messageController.getMessageById(groupId, messageId);
        if (!target) {
          const messages = await messageController.getLatestWindow(
            groupId,
            Number(process.env.GROUP_MESSAGE_MAX || 100)
          );
          target = (messages || []).find((m) => m.messageId === messageId);
        }
      } else if (timestamp) {
        const messages = await messageController.getLatestWindow(
          groupId,
          Number(process.env.GROUP_MESSAGE_MAX || 100)
        );
        target = (messages || []).find((m) => m.timestamp === timestamp);
      }
      if (
        !target ||
        (target.userId
          ? target.userId !== user.userId
          : target.username !== user.username)
      ) {
        socket.emit("edit-error", { error: "Not allowed or message missing" });
        return;
      }
      const success = messageId
        ? messageController.editMessageById(groupId, messageId, newText)
        : messageController.editMessage(
            groupId,
            target.username,
            target.timestamp,
            newText
          );
      if (success && success.success) {
        io.to(groupId).emit("message-edited", {
          groupId,
          messageId: target.messageId,
          newText,
          lastEditedAt: success.lastEditedAt,
          edited: true,
        });
      } else if (success === true) {
        io.to(groupId).emit("message-edited", {
          groupId,
          messageId: target.messageId,
          newText,
          edited: true,
        });
      } else {
        socket.emit("edit-error", { error: "Edit failed" });
      }
    });

    socket.on("delete-message", async (payload) => {
      // unchanged delete logic...
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "You must join a group first" });
        return;
      }
      const { messageId, groupId: providedGroupId, timestamp } = payload || {};
      const groupId = providedGroupId || user.activeGroupId;
      const dmAllowed =
        groupId &&
        groupId.startsWith("dm:") &&
        userInDm(groupId, user.username);
      if (!groupId || (!dmAllowed && !user.groups.includes(groupId))) {
        socket.emit("delete-error", { error: "Invalid data" });
        return;
      }
      let target = null;
      if (messageId) {
        target = messageController.getMessageById(groupId, messageId);
        if (!target) {
          const messages = await messageController.getLatestWindow(
            groupId,
            Number(process.env.GROUP_MESSAGE_MAX || 100)
          );
          target = (messages || []).find((m) => m.messageId === messageId);
        }
      } else if (timestamp) {
        const messages = await messageController.getLatestWindow(
          groupId,
          Number(process.env.GROUP_MESSAGE_MAX || 100)
        );
        target = (messages || []).find((m) => m.timestamp === timestamp);
      }
      if (
        !target ||
        (target.userId
          ? target.userId !== user.userId
          : target.username !== user.username)
      ) {
        socket.emit("delete-error", {
          error: "Not allowed or message missing",
        });
        return;
      }
      const result = messageId
        ? messageController.deleteMessageById(groupId, messageId)
        : messageController.deleteMessage(
            groupId,
            target.username,
            target.timestamp
          );

      // Support both new object-style and legacy boolean return
      if ((result && result.success) || result === true) {
        const deletedAt =
          (result && result.deletedAt) || new Date().toISOString();

        io.to(groupId).emit("message-deleted", {
          groupId,
          // Prefer canonical id; also send legacy keys for clients without ids
          messageId: target.messageId,
          timestamp: target.timestamp,
          username: target.username,
          deletedAt,
        });
      } else {
        socket.emit("delete-error", { error: "Delete failed" });
      }
    });

    // DISCONNECT — if no remaining sockets for this username, force offline now
    socket.on("disconnect", () => {
      const user = userController.getUser(socket.id);
      if (!user) return;
      if (user.pendingDisconnect) return;

      user.pendingDisconnect = true;
      user.disconnectAt = Date.now();
      user._graceTimer = setTimeout(() => {
        const still = userController.getUser(socket.id);
        if (still && still.pendingDisconnect) {
          const groups = still.groups || [];
          const leavingUsername = still.username;
          userController.removeUser(socket.id);

          groups.forEach((g) => {
            socket
              .to(g)
              .emit("user-left", { groupId: g, username: leavingUsername });
            const list = userController.getUsersByGroup(g);
            io.to(g).emit("user-list", { groupId: g, users: list });

            // UPDATED: queue aggregated leave
            queueAggregatedSystem(io, g, "leave", leavingUsername);
          });
          broadcastOnlineCounts(io, userController);
          broadcastPresenceOffline(io, leavingUsername, userController);
        }
      }, GRACE_MS);
    });

    socket.on("update-profile", async (payload = {}) => {
      const { username: newUsernameRaw, avatar: newAvatarRaw } = payload;
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }
      const newUsername =
        typeof newUsernameRaw === "string" ? newUsernameRaw.trim() : "";
      if (!newUsername) {
        socket.emit("profile-error", { message: "Username required" });
        return;
      }
      const normalizedAvatar = await normalizeAvatarToUrl(
        socket,
        newUsername || user.username,
        newAvatarRaw
      );

      const oldUsername = user.username;
      const changedName = oldUsername !== newUsername;
      const changedAvatar =
        normalizedAvatar !== undefined && normalizedAvatar !== user.avatar;

      if (!changedName && !changedAvatar) {
        socket.emit("profile-updated", {
          username: user.username,
          avatar: user.avatar,
        });
        return;
      }

      // Update user record
      userController.updateUser(socket.id, {
        username: newUsername,
        avatar: normalizedAvatar ?? null,
      });

      // Update historical messages by userId
      try {
        messageController.updateUserProfile(user.userId, {
          username: newUsername,
          avatar: normalizedAvatar ?? null,
        });
      } catch (e) {
        console.error("Failed updating historical messages for profile:", e);
      }

      // Broadcast to each group
      (user.groups || []).forEach((g) => {
        // refreshed user list
        const list = userController.getUsersByGroup(g);
        // send updated list
        socket.to(g).emit("user-list", { groupId: g, users: list });
        socket.emit("user-list", { groupId: g, users: list }); // echo for self

        // granular event for targeted UI updates
        const evt = {
          groupId: g,
          userId: user.userId,
          username: newUsername,
          avatar: normalizedAvatar ?? null,
          // optionally include oldUsername if consumer wants rename banner
          oldUsername,
        };
        io.to(g).emit("user-profile-updated", evt);
      });

      // After userController.updateUser and message updates:
      // Move presence state if changed
      if (oldUsername && newUsername && oldUsername !== newUsername) {
        const from = String(oldUsername).toLowerCase();
        const to = String(newUsername).toLowerCase();
        // Transfer lastActive
        const last = lastActiveByUser.get(from);
        if (last) lastActiveByUser.set(to, last);
        // Adjust active set
        if (activeUsers.has(from)) {
          activeUsers.delete(from);
          activeUsers.add(to);
        }
        // Broadcast rename + ensure online for new name
        io.emit("presence:rename", { from, to });
        io.emit("presence:online", {
          username: to,
          at: lastActiveByUser.get(to) || Date.now(),
        });
      }

      socket.emit("profile-updated", {
        username: newUsername,
        avatar: normalizedAvatar ?? null,
      });
    });

    // React to a message (toggle behavior: same emoji removes)
    socket.on("react-message", async (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "You must join a group first" });
        return;
      }

      const { groupId: providedGroupId, messageId, timestamp, emoji } = payload;
      const groupId = providedGroupId || user.activeGroupId;
      if (!groupId || !user.groups?.includes(groupId)) {
        socket.emit("reaction-error", {
          error: "Invalid group or not a member",
        });
        return;
      }

      // Validate: if provided, must be a non-empty string; undefined/null means "clear"
      if (emoji !== undefined && emoji !== null) {
        const isValid = typeof emoji === "string" && emoji.trim().length > 0;
        if (!isValid) {
          socket.emit("reaction-error", { error: "Invalid emoji" });
          return;
        }
      }

      let result;
      const userInfo = { userId: user.userId, username: user.username };

      try {
        if (messageId) {
          result = await messageController.updateReactionById(
            groupId,
            messageId,
            userInfo,
            emoji
          );
        } else if (timestamp) {
          result = await messageController.updateReactionByTimestamp(
            groupId,
            timestamp,
            userInfo,
            emoji
          );
        } else {
          socket.emit("reaction-error", {
            error: "messageId or timestamp required",
          });
          return;
        }
      } catch (e) {
        console.error("react-message failed:", e);
        socket.emit("reaction-error", { error: "Server error" });
        return;
      }

      if (!result || result.success !== true) {
        socket.emit("reaction-error", {
          error: result?.error || "Update failed",
        });
        return;
      }

      // Broadcast the update to the whole group
      io.to(groupId).emit("message-reaction", {
        groupId,
        messageId: result.messageId,
        summary: result.summary, // { totalCount, mostRecent }
        reactions: result.reactions, // { [userId]: { emoji, at, userId, username } }
      });
    });

    // ----- Direct Messages (DM) -----

    // Join a DM room
    socket.on("dm:join", async (data = {}) => {
      const { dmId, userId, username, avatar, bubbleColor } = data;
      if (!isValidDmId(dmId)) {
        socket.emit("error", { message: "Invalid dmId" });
        return;
      }
      if (!username || !userInDm(dmId, username)) {
        socket.emit("error", { message: "Not a participant of this DM" });
        return;
      }
      const normalizedAvatar = await normalizeAvatarToUrl(
        socket,
        username,
        avatar
      );

      const existing = userController.getUser(socket.id);
      if (existing) {
        userController.updateUser(socket.id, {
          userId: existing.userId || userId,
          username,
          avatar: normalizedAvatar ?? null,
          ...(bubbleColor ? { bubbleColor } : {}),
        });
      } else {
        userController.addUser(socket.id, {
          userId,
          username,
          avatar: normalizedAvatar ?? null,
          ...(bubbleColor ? { bubbleColor } : {}),
          groups: [], // don't pollute group lists; avoid aggregated system messages for DMs
          activeGroupId: null,
          pendingDisconnect: false,
          disconnectAt: null,
          _graceTimer: null,
          // optional: track DMs for your own inspection
          dms: [dmId],
        });
      }
      socket.join(dmId);
      // Load latest window from Redis Streams so history persists across restarts
      try {
        const count = Number(process.env.GROUP_MESSAGE_MAX || 100);
        const messages = await messageController.getLatestWindow(dmId, count);
        socket.emit("dm:history", { dmId, messages });
      } catch (e) {
        // fallback to whatever is cached/sync (may be empty on cold start)
        socket.emit("dm:history", {
          dmId,
          messages: messageController.getMessages(dmId) || [],
        });
      }
      // Also send participants' current avatars (from live users or last message fallback)
      try {
        const parts = dmParticipants(dmId); // ['alice','bob'] lowercased
        const list = messageController.getMessages(dmId) || [];
        const allUsers = userController.getAllUsers() || [];
        const participants = parts.map((lc) => {
          // Find live user record first
          const live = allUsers.find(
            (u) =>
              u &&
              typeof u.username === "string" &&
              u.username.toLowerCase() === lc
          );
          let username = live?.username || lc;
          let avatar = live?.avatar || null;
          // Fallback to last message by that user for avatar/casing
          if (!avatar) {
            for (let i = list.length - 1; i >= 0; i--) {
              const m = list[i];
              if (
                m &&
                typeof m.username === "string" &&
                m.username.toLowerCase() === lc
              ) {
                username = m.username || username;
                avatar = m.avatar || avatar;
                break;
              }
            }
          }
          return { username, avatar: avatar ?? null };
        });
        socket.emit("dm:participants", { dmId, participants });
      } catch (e) {
        // non-fatal
        console.warn("dm:participants emit failed:", e?.message || e);
      }

      if (username) markActive(io, username);
    });

    // Leave a DM room
    socket.on("dm:leave", ({ dmId } = {}) => {
      if (!isValidDmId(dmId)) return;
      socket.leave(dmId);
    });

    // Send a DM message
    socket.on("dm:message", async (rawPayload = {}) => {
      const user = userController.getUser(socket.id);
      const {
        dmId,
        text,
        replyToMessageId,
        replyToTimestamp,
        kind,
        media,
        localId, // <-- carry through to help client reconcile
      } = rawPayload;

      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }
      if (!isValidDmId(dmId) || !text || !userInDm(dmId, user.username)) {
        socket.emit("error", { message: "Invalid DM or not a participant" });
        return;
      }

      const messageData = {
        userId: user.userId,
        username: user.username,
        avatar: user.avatar,
        bubbleColor: user.bubbleColor,
        text: String(text),
        kind,
        media,
      };

      // Resolve reply target if provided (with fallback to latest window)
      let original = null;
      if (replyToMessageId) {
        original = messageController.getMessageById(dmId, replyToMessageId);
        if (!original) {
          try {
            const messages = await messageController.getLatestWindow(
              dmId,
              Number(process.env.GROUP_MESSAGE_MAX || 100)
            );
            original = (messages || []).find(
              (m) => m.messageId === replyToMessageId
            );
          } catch {}
        }
      } else if (replyToTimestamp) {
        original = messageController.getMessageByTimestamp(
          dmId,
          replyToTimestamp
        );
        if (!original) {
          try {
            const messages = await messageController.getLatestWindow(
              dmId,
              Number(process.env.GROUP_MESSAGE_MAX || 100)
            );
            original = (messages || []).find(
              (m) => m.timestamp === replyToTimestamp
            );
          } catch {}
        }
      }
      if (original) {
        messageData.replyTo = {
          messageId: original.messageId,
          username: original.username,
          text: original.text,
          timestamp: original.timestamp,
          // NEW: include media/kind for reply preview
          ...(original.kind ? { kind: original.kind } : {}),
          ...(original.media ? { media: original.media } : {}),
        };
      } else if (replyToMessageId || replyToTimestamp) {
        socket.emit("reply-warn", {
          warning: "Original message not found",
          replyToMessageId,
          replyToTimestamp,
        });
      }

      const saved = messageController.createMessage(dmId, messageData);

      // Include dmId and localId in the outgoing payload
      const out = { ...saved, dmId, ...(localId ? { localId } : {}) };

      // Emit to participants who joined the DM room
      io.to(dmId).emit("dm:message", out);

      // Also emit to the peer's sockets even if they didn't join the DM room yet
      try {
        const parts = dmParticipants(dmId) || [];
        const me = String(user.username).toLowerCase();
        const peer = parts.find((p) => p !== me);
        if (peer) {
          const roomSet = io.sockets.adapter.rooms.get(dmId) || new Set();
          const targetSocketIds = [];
          for (const [sid] of io.sockets.sockets) {
            // Skip sockets already in the DM room to avoid duplicate emits
            if (roomSet.has(sid)) continue;
            const u = userController.getUser(sid);
            if (
              u &&
              !u.pendingDisconnect &&
              String(u.username).toLowerCase() === peer
            ) {
              targetSocketIds.push(sid);
            }
          }
          if (targetSocketIds.length) {
            io.to(targetSocketIds).emit("dm:message", out);
          }
        }
      } catch (e) {
        console.error("dm:message peer emit failed:", e);
      }

      // touch activity
      if (user?.username) markActive(io, user.username);
    });

    // Edit a DM message (author-only)
    socket.on("dm:edit", (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("edit-error", { error: "Not authenticated" });
        return;
      }
      const { dmId, target, newText } = payload;
      if (!isValidDmId(dmId) || !newText || !userInDm(dmId, user.username)) {
        socket.emit("dm:edit-error", { error: "Invalid data" });
        return;
      }

      // Lookup target
      let found = null;
      if (target?.messageId) {
        found = messageController.getMessageById(dmId, target.messageId);
      } else if (target?.timestamp && target?.username) {
        const list = messageController.getMessages(dmId);
        found = list.find(
          (m) =>
            m.timestamp === target.timestamp && m.username === target.username
        );
      }

      if (!found) {
        socket.emit("dm:edit-error", { error: "Message not found" });
        return;
      }
      if (
        found.userId
          ? found.userId !== user.userId
          : found.username !== user.username
      ) {
        socket.emit("dm:edit-error", { error: "Not allowed" });
        return;
      }

      const result = target?.messageId
        ? messageController.editMessageById(
            dmId,
            target.messageId,
            String(newText)
          )
        : messageController.editMessage(
            dmId,
            found.username,
            found.timestamp,
            String(newText)
          );

      if (!result || result.success !== true) {
        socket.emit("dm:edit-error", { error: "Edit failed" });
        return;
      }

      io.to(dmId).emit("dm:edit", {
        dmId,
        target: target?.messageId
          ? { messageId: target.messageId }
          : { username: found.username, timestamp: found.timestamp },
        newText: String(newText),
        lastEditedAt: result.lastEditedAt,
        edited: true,
      });
    });

    // Delete a DM message (author-only, soft delete)
    socket.on("dm:delete", async (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("delete-error", { error: "Not authenticated" });
        return;
      }
      const { dmId, target } = payload || {};
      if (!isValidDmId(dmId) || !target || !userInDm(dmId, user.username)) {
        socket.emit("dm:delete-error", { error: "Invalid data" });
        return;
      }

      // Lookup target, with fallback to latest window if not found in cache
      let found = null;
      if (target?.messageId) {
        found = messageController.getMessageById(dmId, target.messageId);
        if (!found) {
          try {
            const messages = await messageController.getLatestWindow(
              dmId,
              Number(process.env.GROUP_MESSAGE_MAX || 100)
            );
            found = (messages || []).find(
              (m) => m.messageId === target.messageId
            );
          } catch {}
        }
      } else if (target?.timestamp && target?.username) {
        try {
          const messages = await messageController.getLatestWindow(
            dmId,
            Number(process.env.GROUP_MESSAGE_MAX || 100)
          );
          found = (messages || []).find(
            (m) =>
              m.timestamp === target.timestamp && m.username === target.username
          );
        } catch {}
      }

      if (!found) {
        socket.emit("dm:delete-error", { error: "Message not found" });
        return;
      }
      if (
        found.userId
          ? found.userId !== user.userId
          : found.username !== user.username
      ) {
        socket.emit("dm:delete-error", { error: "Not allowed" });
        return;
      }

      const result = target?.messageId
        ? messageController.deleteMessageById(dmId, target.messageId)
        : messageController.deleteMessage(
            dmId,
            found.username,
            found.timestamp
          );

      if (!result || result.success !== true) {
        socket.emit("dm:delete-error", { error: "Delete failed" });
        return;
      }

      io.to(dmId).emit("dm:delete", {
        dmId,
        target: target?.messageId
          ? { messageId: target.messageId }
          : { username: found.username, timestamp: found.timestamp },
        deletedAt: result.deletedAt || new Date().toISOString(),
      });
    });

    // React to a DM message (toggle per user)
    socket.on("dm:react", async (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("reaction-error", { error: "Not authenticated" });
        return;
      }
      const { dmId, messageId, timestamp, emoji } = payload || {};
      if (!isValidDmId(dmId) || !userInDm(dmId, user.username)) {
        socket.emit("dm:reaction-error", {
          error: "Invalid DM or not a participant",
        });
        return;
      }
      if (emoji !== undefined && emoji !== null) {
        const isValid = typeof emoji === "string" && emoji.trim().length > 0;
        if (!isValid) {
          socket.emit("dm:reaction-error", { error: "Invalid emoji" });
          return;
        }
      }
      let result;
      const userInfo = { userId: user.userId, username: user.username };
      try {
        if (messageId) {
          result = await messageController.updateReactionById(
            dmId,
            messageId,
            userInfo,
            emoji
          );
        } else if (timestamp) {
          result = await messageController.updateReactionByTimestamp(
            dmId,
            timestamp,
            userInfo,
            emoji
          );
        } else {
          socket.emit("dm:reaction-error", {
            error: "messageId or timestamp required",
          });
          return;
        }
      } catch (e) {
        console.error("dm:react failed:", e);
        socket.emit("dm:reaction-error", { error: "Server error" });
        return;
      }
      if (!result || result.success !== true) {
        socket.emit("dm:reaction-error", {
          error: result?.error || "Update failed",
        });
        return;
      }
      io.to(dmId).emit("dm:reaction", {
        dmId,
        messageId: result.messageId,
        summary: result.summary,
        reactions: result.reactions,
      });
    });

    // NEW: lightweight session registration for non-group features (e.g., dating likes)
    socket.on("session:register", async (payload = {}) => {
      const { userId, username, avatar, bubbleColor } = payload;
      const normalizedAvatar = await normalizeAvatarToUrl(
        socket,
        username,
        avatar
      );
      const u = userController.getUser(socket.id);
      if (u) {
        userController.updateUser(socket.id, {
          userId: u.userId || userId,
          username: username || u.username,
          avatar: normalizedAvatar !== undefined ? normalizedAvatar : u.avatar,
          ...(bubbleColor ? { bubbleColor } : {}),
        });
      } else if (username) {
        userController.addUser(socket.id, {
          userId,
          username,
          avatar: normalizedAvatar ?? null,
          ...(bubbleColor ? { bubbleColor } : {}),
          groups: [],
          activeGroupId: null,
          pendingDisconnect: false,
          disconnectAt: null,
          _graceTimer: null,
        });
      }
      if (username) markActive(io, username);

      // NEW: replay current incoming likes for this user so offline likes are visible
      const effectiveUser =
        (username && String(username).trim()) ||
        userController.getUser(socket.id)?.username ||
        null;
      if (effectiveUser) {
        try {
          const incoming = datingModel.getIncomingLikesFor(effectiveUser);
          if (incoming && incoming.length) {
            for (const { from, at } of incoming) {
              // Build profile summary from the liker
              const summary = buildProfileSummaryForLike(from);
              socket.emit("dating:liked", {
                from,
                profile: summary,
                at,
              });
            }
          }
        } catch (e) {
          console.error("Failed to replay incoming likes:", e);
        }
      }

      // NEW: Also replay a DM threads snapshot persisted in Redis Streams
      try {
        const meLc = String(
          (
            username ||
            userController.getUser(socket.id)?.username ||
            ""
          ).toLowerCase()
        );
        if (meLc) {
          const dmIds = await require("../models/storage").listDmIdsForUser(
            meLc
          );
          // Compute latest timestamp for each dmId by peeking tail entry
          const threads = [];
          for (const dmId of dmIds) {
            try {
              const tail = await require("../models/storage").xRangeLatest(
                dmId,
                1,
                { reverse: true }
              );
              const last = (tail && tail[tail.length - 1]) || null;
              const ts = last?.timestamp || null;
              threads.push({ dmId, latest: ts, last: last || null });
            } catch {}
          }
          if (threads.length) {
            socket.emit("dm:threads", { threads });
          }
        }
      } catch (e) {
        console.warn("dm:threads snapshot failed:", e?.message || e);
      }
    });

    // username-based dating like flow used by the frontend
    socket.on("dating:like", (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }

      const toRaw = (payload && payload.to) || "";
      const toLc = String(toRaw).trim().toLowerCase();
      const from = user.username;
      const fromLc = String(from || "").toLowerCase();

      if (!toLc) {
        socket.emit("error", { message: "Missing 'to' username" });
        return;
      }
      if (!from || fromLc === toLc) {
        // Disallow liking self
        socket.emit("error", { message: "Invalid like target" });
        return;
      }

      // NEW: persist the like
      const saved = datingModel.addLike(from, toRaw);

      // Notify target if online (works for online users)
      const targetSockets = getSocketIdsForUsername(io, toLc);
      if (targetSockets.length) {
        const summary = buildProfileSummaryForLike(from);
        io.to(targetSockets).emit("dating:liked", {
          from,
          profile: summary,
          at: saved?.at || Date.now(),
        });
      }
    });

    socket.on("dating:unlike", (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }

      const toRaw = (payload && payload.to) || "";
      const toLc = String(toRaw).trim().toLowerCase();
      const from = user.username;
      const fromLc = String(from || "").toLowerCase();

      if (!toLc) {
        socket.emit("error", { message: "Missing 'to' username" });
        return;
      }
      if (!from || fromLc === toLc) {
        return;
      }

      // NEW: remove persisted like
      datingModel.removeLike(from, toRaw);

      // Notify target if online
      const targetSockets = getSocketIdsForUsername(io, toLc);
      if (targetSockets.length) {
        io.to(targetSockets).emit("dating:unliked", {
          from,
          at: Date.now(),
        });
      }
    });

    // NEW: dating "report" action (from client to server)
    socket.on("report", (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }
      const { profileId, reason } = payload;

      // Validate: must be a number (ObjectId)
      if (typeof profileId !== "string" || profileId.length !== 24) {
        socket.emit("error", { message: "Invalid profile" });
        return;
      }

      // Report the user (store in reports collection)
      datingModel.report(user.userId, profileId, reason);

      socket.emit("reported", { profileId });
    });

    // NEW: dating "view profile" action (from client to server)
    socket.on("view-profile", (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }
      const { profileId } = payload;

      // Validate: must be a number (ObjectId)
      if (typeof profileId !== "string" || profileId.length !== 24) {
        socket.emit("error", { message: "Invalid profile" });
        return;
      }

      // Record the profile view (store in views collection)
      datingModel.viewProfile(user.userId, profileId);

      socket.emit("profile-viewed", { profileId });
    });

    // NEW: dating "get profile" request (from client to server)
    socket.on("get-profile", (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }
      const { profileId } = payload;

      // Validate: must be a number (ObjectId)
      if (typeof profileId !== "string" || profileId.length !== 24) {
        socket.emit("error", { message: "Invalid profile" });
        return;
      }

      // Fetch the profile data
      const profile = datingModel.getById(profileId);
      if (!profile) {
        socket.emit("error", { message: "Profile not found" });
        return;
      }

      // Send the profile data to the client
      socket.emit("profile-data", { profile });
    });

    // NEW: dating "get matches" request (from client to server)
    socket.on("get-matches", (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }

      // Fetch the user's matches
      const matches = datingModel.getMatches(user.userId);

      // Send the matches data to the client
      socket.emit("matches-data", { matches });
    });

    // NEW: dating "get likes" request (from client to server)
    socket.on("get-likes", (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }

      // Fetch the user's likes
      const likes = datingModel.getLikes(user.userId);

      // Send the likes data to the client
      socket.emit("likes-data", { likes });
    });

    // NEW: dating "get blocks" request (from client to server)
    socket.on("get-blocks", (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }

      // Fetch the user's blocks
      const blocks = datingModel.getBlocks(user.userId);

      // Send the blocks data to the client
      socket.emit("blocks-data", { blocks });
    });

    // NEW: dating "get reports" request (from client to server)
    socket.on("get-reports", (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }

      // Fetch the user's reports
      const reports = datingModel.getReports(user.userId);

      // Send the reports data to the client
      socket.emit("reports-data", { reports });
    });

    // NEW: dating "get profile views" request (from client to server)
    socket.on("get-profile-views", (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }

      // Fetch the user's profile views
      const views = datingModel.getProfileViews(user.userId);

      // Send the profile views data to the client
      socket.emit("profile-views-data", { views });
    });

    // NEW: dating "like notification" ack (from client to server)
    socket.on("like-notification-ack", (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }
      const { profileId } = payload;

      // Validate: must be a number (ObjectId)
      if (typeof profileId !== "string" || profileId.length !== 24) {
        socket.emit("error", { message: "Invalid profile" });
        return;
      }

      // Acknowledge the like notification (remove from pending)
      datingModel.acknowledgeLikeNotification(user.userId, profileId);

      socket.emit("like-notification-acknowledged", { profileId });
    });

    // NEW: dating "super like notification" ack (from client to server)
    socket.on("super-like-notification-ack", (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }
      const { profileId } = payload;

      // Validate: must be a number (ObjectId)
      if (typeof profileId !== "string" || profileId.length !== 24) {
        socket.emit("error", { message: "Invalid profile" });
        return;
      }

      // Acknowledge the super like notification (remove from pending)
      datingModel.acknowledgeSuperLikeNotification(user.userId, profileId);

      socket.emit("super-like-notification-acknowledged", { profileId });
    });

    // NEW: dating "block notification" ack (from client to server)
    socket.on("block-notification-ack", (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }
      const { profileId } = payload;

      // Validate: must be a number (ObjectId)
      if (typeof profileId !== "string" || profileId.length !== 24) {
        socket.emit("error", { message: "Invalid profile" });
        return;
      }

      // Acknowledge the block notification (remove from pending)
      datingModel.acknowledgeBlockNotification(user.userId, profileId);

      socket.emit("block-notification-acknowledged", { profileId });
    });

    // NEW: dating "report notification" ack (from client to server)
    socket.on("report-notification-ack", (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }
      const { profileId } = payload;

      // Validate: must be a number (ObjectId)
      if (typeof profileId !== "string" || profileId.length !== 24) {
        socket.emit("error", { message: "Invalid profile" });
        return;
      }

      // Acknowledge the report notification (remove from pending)
      datingModel.acknowledgeReportNotification(user.userId, profileId);

      socket.emit("report-notification-acknowledged", { profileId });
    });

    // NEW: dating "view profile notification" ack (from client to server)
    socket.on("view-profile-notification-ack", (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }
      const { profileId } = payload;

      // Validate: must be a number (ObjectId)
      if (typeof profileId !== "string" || profileId.length !== 24) {
        socket.emit("error", { message: "Invalid profile" });
        return;
      }

      // Acknowledge the view profile notification (remove from pending)
      datingModel.acknowledgeViewProfileNotification(user.userId, profileId);

      socket.emit("view-profile-notification-acknowledged", { profileId });
    });
  });
}

// Aggregation state for join/leave system messages
const aggregationState = {
  join: new Map(),
  leave: new Map(),
};

// =========================
// Avatar normalization helpers
// =========================

// Removed: no absolute conversion for local /uploads paths

// Removed local avatar saving; avatars are uploaded to Cloudinary

const {
  isEnabled: cloudEnabled,
  uploadDataUrl,
} = require("../config/cloudinary");

// Save a data URL chat media (image/video) to Cloudinary and return hosted URL
async function saveDataUrlToChatFile(socket, username, dataUrl) {
  if (typeof dataUrl !== "string") return null;

  // Accept common raster image formats or video formats for chat media
  let m = dataUrl.match(
    /^data:((?:image|video)\/[a-z0-9+\-.]+);base64,([a-z0-9+/=]+)$/i
  );
  if (!m) return null;

  const mime = m[1].toLowerCase();
  // const b64 = m[2]; // no local writes

  const extMap = {
    // images
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    // videos
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "video/ogg": ".ogv",
  };
  // ext only used for legacy local saves; keep for reference
  const fallback = mime.startsWith("video/") ? ".mp4" : ".png";
  const ext = extMap[mime] || fallback;

  // If Cloudinary configured, upload data URL and return hosted URL
  try {
    if (cloudEnabled()) {
      const folder = process.env.CLOUDINARY_CHAT_FOLDER || "funly/chat";
      const url = await uploadDataUrl(dataUrl, {
        folder,
        resourceType: mime.startsWith("video/") ? "video" : "image",
      });
      if (url) return url;
    }
  } catch (e) {
    // If upload fails, return null and let caller decide fallback (e.g., keep data URL)
  }

  return null;
}

// Normalize media object fields to absolute URLs; persist data URLs to files under /uploads/chat
async function normalizeMediaForMessage(socket, username, media) {
  if (!media) return undefined;

  // If a simple string, treat as original URL
  if (typeof media === "string") {
    const original = await normalizeUrlLike(socket, username, media);
    return { original };
  }

  const out = {};

  // Known fields to process
  const fields = ["original", "preview", "gif", "thumbnail"];
  for (const key of fields) {
    const val = media[key];
    if (val === undefined) continue;
    out[key] = await normalizeUrlLike(
      socket,
      username,
      val,
      /*isPreview*/ key !== "original"
    );
  }

  // Carry type if provided by uploader route (mime)
  if (media.type) out.type = media.type;
  return out;
}

// Helper: normalize a possibly data/relative URL into absolute URL, saving files when needed
async function normalizeUrlLike(socket, username, value, isPreview = false) {
  if (value == null) return value;
  const val = String(value).trim();
  if (!val) return val;

  // Already absolute
  if (/^https?:\/\//i.test(val)) return val;

  // Data URL image -> save into chat dir and convert to absolute
  if (/^data:(?:image|video)\//i.test(val)) {
    const url = await saveDataUrlToChatFile(socket, username, val);
    return url || val; // fallback to data URL if save failed
  }

  // Known legacy local uploads path -> leave as-is (served only if server still exposes /uploads)
  if (val.startsWith("/uploads/")) return val;
  if (val.startsWith("uploads/")) return val;

  // Unknown scheme -> return as-is to avoid data loss
  return val;
}

// Normalize avatar input to an absolute URL (or null to clear, or undefined for no change)
async function normalizeAvatarToUrl(socket, username, avatar) {
  // undefined => no change
  if (avatar === undefined) return undefined;

  const val = String(avatar || "").trim();
  // empty string/null => explicit clear
  if (!val) return null;

  // Already absolute
  if (/^https?:\/\//i.test(val)) return val;

  // Data URL -> try Cloudinary; if upload fails, keep the data URL (still renderable)
  if (/^data:image\//i.test(val)) {
    // Try Cloudinary first if enabled
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

  // Legacy relative uploads path -> leave as-is (compat)
  if (val.startsWith("/uploads/")) return val;
  if (val.startsWith("uploads/")) return val;

  // Unknown input -> do not store raw; clear it
  return null;
}

module.exports = {
  setupSocket,
  // ...existing exports...
};
