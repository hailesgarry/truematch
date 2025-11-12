const {
  messageController,
  userController,
  initSharedState,
  refreshUserFilters,
  loadLatestHistory,
  getFilterBucket,
  filterMessagesForScope,
  normalizeAvatarToUrl,
  emitToRoomRespectingFilters,
  emitToSocketIdsRespectingFilters,
  markActive,
  dmParticipants,
  isValidDmId,
  userInDm,
  buildProfileSummaryForLike,
} = require("./shared");
const py = require("../lib/pyClient");

const TYPING_THROTTLE_MS = 300;
const TYPING_TTL_MS = 6000;
const typingThrottle = new Map();

function setupDmSocketHandlers(io) {
  initSharedState(io);

  io.on("connection", (socket) => {
    const buildTargetPayload = (source, fallbackUsername) => {
      if (!source || typeof source !== "object") {
        return null;
      }
      const raw =
        typeof source.target === "object" && source.target
          ? source.target
          : source;
      const payload = {};
      const hasMessageId =
        raw.messageId !== undefined && raw.messageId !== null;
      const hasTimestamp =
        raw.timestamp !== undefined && raw.timestamp !== null;
      if (hasMessageId) payload.messageId = raw.messageId;
      if (hasTimestamp) payload.timestamp = raw.timestamp;
      if (!hasMessageId && !hasTimestamp) return null;
      const usernameValue =
        raw.username !== undefined && raw.username !== null
          ? raw.username
          : fallbackUsername;
      if (usernameValue) payload.username = usernameValue;
      return payload;
    };

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
          groups: [],
          activeGroupId: null,
          pendingDisconnect: false,
          disconnectAt: null,
          _graceTimer: null,
          dms: [dmId],
        });
      }
      socket.join(dmId);
      const freshUser = userController.getUser(socket.id);
      const { map: dmFilters } = await refreshUserFilters(
        socket,
        freshUser,
        true
      );
      const rawHistory = await loadLatestHistory(dmId);
      const effectiveFilters =
        dmFilters || (freshUser && freshUser.filtersByGroup) || {};
      const filterBucket = getFilterBucket(effectiveFilters, dmId);
      const filteredHistory = filterMessagesForScope(rawHistory, filterBucket);
      socket.emit("dm:history", { dmId, messages: filteredHistory });
      try {
        const parts = dmParticipants(dmId);
        const list = rawHistory || [];
        const allUsers = userController.getAllUsers() || [];
        const participants = parts.map((lc) => {
          const live = allUsers.find(
            (u) =>
              u &&
              typeof u.username === "string" &&
              u.username.toLowerCase() === lc
          );
          let liveUsername = live?.username || lc;
          let liveAvatar = live?.avatar || null;
          if (!liveAvatar) {
            for (let i = list.length - 1; i >= 0; i--) {
              const m = list[i];
              if (
                m &&
                typeof m.username === "string" &&
                m.username.toLowerCase() === lc
              ) {
                liveUsername = m.username || liveUsername;
                liveAvatar = m.avatar || liveAvatar;
                break;
              }
            }
          }
          return { username: liveUsername, avatar: liveAvatar ?? null };
        });
        socket.emit("dm:participants", { dmId, participants });
      } catch (e) {
        console.warn("dm:participants emit failed:", e?.message || e);
      }

      if (username) markActive(io, username);
    });

    socket.on("dm:leave", ({ dmId } = {}) => {
      if (!isValidDmId(dmId)) return;
      socket.leave(dmId);
    });

    socket.on("dm:message", async (rawPayload = {}) => {
      const user = userController.getUser(socket.id);
      const {
        dmId,
        text,
        replyToMessageId,
        replyToTimestamp,
        kind,
        media,
        audio,
        localId,
      } = rawPayload;

      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }
      const trimmedText = typeof text === "string" ? text.trim() : "";
      const hasText = trimmedText.length > 0;
      const hasMedia = Boolean(media);
      const hasAudio = Boolean(audio) || kind === "audio";

      if (
        !isValidDmId(dmId) ||
        !userInDm(dmId, user.username) ||
        (!hasText && !hasMedia && !hasAudio)
      ) {
        socket.emit("error", { message: "Invalid DM or not a participant" });
        return;
      }

      const messageData = {
        userId: user.userId,
        username: user.username,
        avatar: user.avatar,
        bubbleColor: user.bubbleColor,
        text: hasText ? String(trimmedText) : "",
        ...(kind ? { kind } : {}),
        ...(hasMedia ? { media } : {}),
        ...(audio ? { audio } : {}),
      };

      let original = null;
      if (replyToMessageId) {
        original = await messageController.getMessageById(
          dmId,
          replyToMessageId
        );
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
        original = await messageController.getMessageByTimestamp(
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

      const saved = await messageController.createMessage(dmId, messageData);

      const base =
        messageData.replyTo && !saved.replyTo
          ? { ...saved, replyTo: messageData.replyTo }
          : saved;
      const out = { ...base, dmId, ...(localId ? { localId } : {}) };

      emitToRoomRespectingFilters(io, dmId, "dm:message", out, {
        authorUsername: out?.username,
        message: out,
      });

      try {
        const parts = dmParticipants(dmId) || [];
        const me = String(user.username).toLowerCase();
        const peer = parts.find((p) => p !== me);
        if (peer) {
          const roomSet = io.sockets.adapter.rooms.get(dmId) || new Set();
          const targetSocketIds = [];
          for (const [sid] of io.sockets.sockets) {
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
            emitToSocketIdsRespectingFilters(
              io,
              targetSocketIds,
              dmId,
              "dm:message",
              out,
              { authorUsername: out?.username, message: out }
            );
          }
        }
      } catch (e) {
        console.error("dm:message peer emit failed:", e);
      }

      if (user?.username) markActive(io, user.username);
    });

    socket.on("dm:typing", (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) return;
      const { dmId, typing, at, ttlMs } = payload || {};
      if (!isValidDmId(dmId) || !userInDm(dmId, user.username)) return;

      const now =
        typeof at === "number" && Number.isFinite(at) ? at : Date.now();
      const key = `${dmId}|${String(user.username || "").toLowerCase()}`;

      if (typing) {
        const last = typingThrottle.get(key) || 0;
        if (now - last < TYPING_THROTTLE_MS) return;
        typingThrottle.set(key, now);
      } else {
        typingThrottle.delete(key);
      }

      const ttl =
        typeof ttlMs === "number" && Number.isFinite(ttlMs) && ttlMs > 0
          ? Math.min(ttlMs, 15000)
          : TYPING_TTL_MS;

      const data = {
        dmId,
        username: user.username,
        typing: Boolean(typing),
        at: now,
        ttlMs: ttl,
      };

      socket.to(dmId).emit("dm:typing", data);

      try {
        const parts = dmParticipants(dmId) || [];
        const me = String(user.username || "").toLowerCase();
        const peer = parts.find((entry) => entry !== me);
        if (peer) {
          const roomSet = io.sockets.adapter.rooms.get(dmId) || new Set();
          const targetSocketIds = [];
          for (const [sid] of io.sockets.sockets) {
            if (roomSet.has(sid)) continue;
            const candidate = userController.getUser(sid);
            if (
              candidate &&
              !candidate.pendingDisconnect &&
              typeof candidate.username === "string" &&
              candidate.username.toLowerCase() === peer
            ) {
              targetSocketIds.push(sid);
            }
          }
          if (targetSocketIds.length) {
            emitToSocketIdsRespectingFilters(
              io,
              targetSocketIds,
              dmId,
              "dm:typing",
              data,
              { authorUsername: user.username }
            );
          }
        }
      } catch (err) {
        console.warn("dm:typing peer emit failed:", err?.message || err);
      }

      if (user?.username) markActive(io, user.username);
    });

    socket.on("dm:edit", async (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("edit-error", { error: "Not authenticated" });
        return;
      }
      const { dmId, target, newText } = payload;
      const requestTarget = buildTargetPayload(payload, user.username);
      if (!isValidDmId(dmId) || !newText || !userInDm(dmId, user.username)) {
        socket.emit("dm:edit-error", {
          error: "Invalid data",
          dmId,
          target: requestTarget,
        });
        return;
      }

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
        socket.emit("dm:edit-error", {
          error: "Message not found",
          dmId,
          target: requestTarget,
        });
        return;
      }
      if (
        found.userId
          ? found.userId !== user.userId
          : found.username !== user.username
      ) {
        socket.emit("dm:edit-error", {
          error: "Not allowed",
          dmId,
          target: buildTargetPayload(found, user.username) || requestTarget,
        });
        return;
      }

      const result = target?.messageId
        ? await messageController.editMessageById(
            dmId,
            target.messageId,
            String(newText)
          )
        : await messageController.editMessage(
            dmId,
            found.username,
            found.timestamp,
            String(newText)
          );

      if (!result || result.success !== true) {
        socket.emit("dm:edit-error", {
          error: "Edit failed",
          dmId,
          target: buildTargetPayload(found, user.username) || requestTarget,
        });
        return;
      }

      emitToRoomRespectingFilters(
        io,
        dmId,
        "dm:edit",
        {
          dmId,
          target: target?.messageId
            ? { messageId: target.messageId }
            : { username: found.username, timestamp: found.timestamp },
          newText: String(newText),
          lastEditedAt: result.lastEditedAt,
          edited: result.edited ?? true,
        },
        { authorUsername: found?.username, timestamp: found?.timestamp }
      );
    });

    socket.on("dm:delete", async (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("delete-error", { error: "Not authenticated" });
        return;
      }
      const { dmId, target } = payload || {};
      const requestTarget = buildTargetPayload(payload, user.username);
      if (!isValidDmId(dmId) || !target || !userInDm(dmId, user.username)) {
        socket.emit("dm:delete-error", {
          error: "Invalid data",
          dmId,
          target: requestTarget,
        });
        return;
      }

      let found = null;
      if (target?.messageId) {
        found = await messageController.getMessageById(dmId, target.messageId);
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
        socket.emit("dm:delete-error", {
          error: "Message not found",
          dmId,
          target: requestTarget,
        });
        return;
      }
      if (
        found.userId
          ? found.userId !== user.userId
          : found.username !== user.username
      ) {
        socket.emit("dm:delete-error", {
          error: "Not allowed",
          dmId,
          target: buildTargetPayload(found, user.username) || requestTarget,
        });
        return;
      }

      const result = target?.messageId
        ? await messageController.deleteMessageById(dmId, target.messageId)
        : await messageController.deleteMessage(
            dmId,
            found.username,
            found.timestamp
          );

      if (!result || result.success !== true) {
        socket.emit("dm:delete-error", {
          error: "Delete failed",
          dmId,
          target: buildTargetPayload(found, user.username) || requestTarget,
        });
        return;
      }

      emitToRoomRespectingFilters(
        io,
        dmId,
        "dm:delete",
        {
          dmId,
          target: target?.messageId
            ? { messageId: target.messageId }
            : { username: found.username, timestamp: found.timestamp },
          deletedAt: result.deletedAt || new Date().toISOString(),
        },
        { authorUsername: found?.username, timestamp: found?.timestamp }
      );
    });

    socket.on("dm:react", async (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("reaction-error", { error: "Not authenticated" });
        return;
      }
      const { dmId, messageId, timestamp, emoji } = payload || {};
      const targetPayload = buildTargetPayload(payload, user.username);
      if (!isValidDmId(dmId) || !userInDm(dmId, user.username)) {
        socket.emit("dm:reaction-error", {
          error: "Invalid DM or not a participant",
          dmId,
          target: targetPayload,
        });
        return;
      }
      if (emoji !== undefined && emoji !== null) {
        const isValid = typeof emoji === "string" && emoji.trim().length > 0;
        if (!isValid) {
          socket.emit("dm:reaction-error", {
            error: "Invalid emoji",
            dmId,
            target: targetPayload,
          });
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
            dmId,
            target: targetPayload,
          });
          return;
        }
      } catch (e) {
        console.error("dm:react failed:", e);
        socket.emit("dm:reaction-error", {
          error: "Server error",
          dmId,
          target: targetPayload,
        });
        return;
      }
      if (!result || result.success !== true) {
        socket.emit("dm:reaction-error", {
          error: result?.error || "Update failed",
          dmId,
          target: buildTargetPayload(result, user.username) || targetPayload,
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

    socket.on("filters:refresh", async (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) return;
      const { groupId, includeHistory = false } = payload || {};
      const scopeId = typeof groupId === "string" ? groupId.trim() : "";
      if (!scopeId || !scopeId.startsWith("dm:")) return;
      if (!userInDm(scopeId, user.username)) return;
      const { map } = await refreshUserFilters(socket, user, true);
      if (!includeHistory) return;
      const history = await loadLatestHistory(scopeId);
      const filterBucket = getFilterBucket(
        map || user.filtersByGroup || {},
        scopeId
      );
      const filteredHistory = filterMessagesForScope(history, filterBucket);
      socket.emit("dm:history", { dmId: scopeId, messages: filteredHistory });
    });

    socket.on("session:register", async (payload = {}) => {
      const { userId, username, avatar, bubbleColor } = payload;
      const normalizedAvatar = await normalizeAvatarToUrl(
        socket,
        username,
        avatar
      );
      const existing = userController.getUser(socket.id);
      if (existing) {
        userController.updateUser(socket.id, {
          userId: existing.userId || userId,
          username: username || existing.username,
          avatar:
            normalizedAvatar !== undefined ? normalizedAvatar : existing.avatar,
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

      const effectiveUser =
        (username && String(username).trim()) ||
        userController.getUser(socket.id)?.username ||
        null;
      if (effectiveUser) {
        (async () => {
          try {
            let incoming = [];
            try {
              const axios = require("axios").default;
              const { data } = await axios.get(
                `${
                  process.env.PY_API_URL || "http://localhost:8081/api"
                }/dating/likes/incoming`,
                { params: { user: effectiveUser } }
              );
              incoming = Array.isArray(data) ? data : [];
            } catch {}
            if (incoming && incoming.length) {
              for (const { from, at } of incoming) {
                const summary = await buildProfileSummaryForLike(from);
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
        })();
      }

      (async () => {
        try {
          const meLc = String(
            (
              username ||
              userController.getUser(socket.id)?.username ||
              ""
            ).toLowerCase()
          );
          if (!meLc) return;
          const threads = await py.dmThreads(meLc);
          socket.emit("dm:threads", {
            threads: Array.isArray(threads) ? threads : [],
          });
        } catch (e) {
          console.warn("dm:threads snapshot failed:", e?.message || e);
          try {
            socket.emit("dm:threads", { threads: [] });
          } catch {}
        }
      })();
    });
  });
}

module.exports = {
  setupDmSocketHandlers,
};
