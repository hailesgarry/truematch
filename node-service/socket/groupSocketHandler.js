const groupController = require("../controllers/groupController");
const {
  messageController,
  userController,
  GRACE_MS,
  initSharedState,
  sendPresenceSnapshot,
  markActive,
  broadcastPresenceOnline,
  broadcastPresenceOffline,
  broadcastOnlineCounts,
  queueAggregatedSystem,
  refreshUserFilters,
  loadLatestHistory,
  getFilterBucket,
  filterMessagesForScope,
  emitToRoomRespectingFilters,
  normalizeMediaForMessage,
  normalizeAvatarToUrl,
  pendingDisconnectByUser,
  getSocketIdsForUsername,
  sanitizeDatingProfilePayload,
  buildProfileSummaryForLike,
  lastActiveByUser,
  activeUsers,
} = require("./shared");
const py = require("../lib/pyClient");

function setupGroupSocketHandlers(io) {
  initSharedState(io);

  io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    sendPresenceSnapshot(socket);

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

    socket.on("presence:ping", () => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) return;
      markActive(io, user.username);
    });

    socket.on("join", async (data = {}) => {
      const { userId, username, groupId } = data;
      const normalizedAvatar = await normalizeAvatarToUrl(
        socket,
        username,
        data.avatar
      );

      if (!userId || !username || !groupId) {
        socket.emit("error", {
          message: "userId, username and groupId are required",
        });
        return;
      }

      if (typeof groupId === "string" && groupId.startsWith("dm:")) {
        socket.emit("error", {
          message: "Use dm handlers for private chats",
        });
        return;
      }

      const groupInfo = await groupController.ensureGroup(groupId);
      if (!groupInfo) {
        socket.emit("error", { message: "Group not found" });
        return;
      }

      const existing = userController.getUser(socket.id);
      let isFirstJoinToGroup = false;
      const usernameLc = (username || "").toLowerCase();

      const pend = pendingDisconnectByUser.get(usernameLc);
      const withinGrace =
        pend && typeof pend.at === "number" && Date.now() - pend.at <= GRACE_MS;
      if (withinGrace) {
        try {
          clearTimeout(pend.timer);
        } catch {}
        pendingDisconnectByUser.delete(usernameLc);
        try {
          if (pend.socketId) userController.removeUser(pend.socketId);
        } catch {}
      }

      if (existing) {
        const wasInGroup = existing.groups.includes(groupId);
        if (!wasInGroup) {
          socket.join(groupId);
          existing.groups.push(groupId);
          isFirstJoinToGroup = true;
        } else {
          const rooms = socket.rooms;
          if (!rooms.has(groupId)) socket.join(groupId);
        }
        existing.activeGroupId = groupId;
        userController.updateUser(socket.id, {
          avatar: normalizedAvatar ?? null,
          ...(data.bubbleColor ? { bubbleColor: data.bubbleColor } : {}),
          groups: existing.groups,
          activeGroupId: groupId,
          pendingDisconnect: false,
          disconnectAt: null,
        });
      } else {
        userController.addUser(socket.id, {
          userId,
          username,
          avatar: normalizedAvatar ?? null,
          ...(data.bubbleColor ? { bubbleColor: data.bubbleColor } : {}),
          groups: [groupId],
          activeGroupId: groupId,
          pendingDisconnect: false,
          disconnectAt: null,
          _graceTimer: null,
        });
        socket.join(groupId);
        isFirstJoinToGroup = true;
      }

      if (data.bubbleColor) {
        messageController.updateUserBubbleColor(
          groupId,
          username,
          data.bubbleColor
        );
      }

      const freshUser = userController.getUser(socket.id);
      const { map: filtersMap } = await refreshUserFilters(
        socket,
        freshUser,
        true
      );
      const rawHistory = await loadLatestHistory(groupId);
      const effectiveFilters =
        filtersMap || (freshUser && freshUser.filtersByGroup) || {};
      const filterBucket = getFilterBucket(effectiveFilters, groupId);
      const filteredHistory = filterMessagesForScope(rawHistory, filterBucket);
      socket.emit("message-history", {
        groupId,
        messages: filteredHistory,
      });

      const list = userController.getUsersByGroup(groupId);
      io.to(groupId).emit("user-list", {
        groupId,
        users: list,
      });

      const isRejoinWithinGrace = Boolean(withinGrace);

      if (!isRejoinWithinGrace) {
        socket.to(groupId).emit("user-joined", { groupId, username });
        if (isFirstJoinToGroup) {
          queueAggregatedSystem(io, groupId, "join", username);
        }
      }

      if (isFirstJoinToGroup) {
        const joinedAt = Date.now();
        py.addGroupMember(groupId, { username, joinedAt }).catch((err) => {
          console.warn(
            `[groupSocket] failed to persist group join for ${username} -> ${groupId}: ${
              err?.message || err
            }`
          );
        });
      }

      broadcastOnlineCounts(io);
      broadcastPresenceOnline(io, username);
    });

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

    socket.on("get-users", ({ groupId } = {}) => {
      if (!groupId) return;
      try {
        const list = userController.getUsersByGroup(groupId);
        socket.emit("user-list", { groupId, users: list });
      } catch (e) {}
    });

    socket.on("message", async (rawPayload, legacyReplyData) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "You must join a group first" });
        return;
      }

      let groupId,
        text,
        replyToMessageId,
        replyToTimestamp,
        kind,
        media,
        audio,
        localId;
      if (typeof rawPayload === "string") {
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
        kind = rawPayload?.kind;
        media = rawPayload?.media;
        audio = rawPayload?.audio;
        localId = rawPayload?.localId;
      }

      if (typeof groupId === "string" && groupId.startsWith("dm:")) {
        socket.emit("error", {
          message: "Use dm handlers for private chats",
        });
        return;
      }

      const hasText = !!(text && String(text).trim());
      const hasMedia = !!media;
      const hasAudio = !!audio || kind === "audio";
      if (
        !groupId ||
        !user.groups.includes(groupId) ||
        (!hasText && !hasMedia && !hasAudio)
      ) {
        socket.emit("error", { message: "Invalid group or not a member" });
        return;
      }

      let normalizedMedia = undefined;
      if (media) {
        normalizedMedia = await normalizeMediaForMessage(
          socket,
          user.username,
          media
        );
      }

      const messageData = {
        messageId: undefined,
        userId: user.userId,
        username: user.username,
        avatar: user.avatar,
        bubbleColor: user.bubbleColor,
        text: hasText ? String(text) : "",
        ...(kind ? { kind } : {}),
        ...(normalizedMedia ? { media: normalizedMedia } : {}),
        ...(audio ? { audio } : {}),
      };

      let original = null;
      if (replyToMessageId) {
        original = await messageController.getMessageById(
          groupId,
          replyToMessageId
        );
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
        original = await messageController.getMessageByTimestamp(
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
          ...(original.kind ? { kind: original.kind } : {}),
          ...(original.media ? { media: original.media } : {}),
        };
      }

      if (
        !messageData.replyTo &&
        rawPayload?.replyTo &&
        typeof rawPayload.replyTo === "object"
      ) {
        const snap = rawPayload.replyTo;
        messageData.replyTo = {
          ...(snap.messageId ? { messageId: snap.messageId } : {}),
          ...(snap.username ? { username: snap.username } : {}),
          ...(snap.text != null ? { text: snap.text } : {}),
          ...(snap.timestamp != null ? { timestamp: snap.timestamp } : {}),
          ...(snap.kind ? { kind: snap.kind } : {}),
          ...(snap.media ? { media: snap.media } : {}),
        };
      }
      if (replyToMessageId) messageData.replyToMessageId = replyToMessageId;
      if (replyToTimestamp) messageData.replyToTimestamp = replyToTimestamp;

      const message = await messageController.createMessage(
        groupId,
        messageData
      );
      const serverRt = (message && message.replyTo) || null;
      const clientSnap =
        rawPayload && typeof rawPayload.replyTo === "object"
          ? rawPayload.replyTo
          : null;
      const isEmptyObj = (v) =>
        v &&
        typeof v === "object" &&
        !Array.isArray(v) &&
        Object.keys(v).length === 0;
      let enriched = message;
      if (!serverRt || isEmptyObj(serverRt)) {
        if (messageData.replyTo) {
          enriched = { ...message, replyTo: messageData.replyTo };
        } else if (clientSnap) {
          const snap = {
            ...(clientSnap.messageId
              ? { messageId: clientSnap.messageId }
              : {}),
            ...(clientSnap.username ? { username: clientSnap.username } : {}),
            ...(clientSnap.text != null ? { text: clientSnap.text } : {}),
            ...(clientSnap.timestamp != null
              ? { timestamp: clientSnap.timestamp }
              : {}),
            ...(clientSnap.kind ? { kind: clientSnap.kind } : {}),
            ...(clientSnap.media ? { media: clientSnap.media } : {}),
          };
          enriched = { ...message, replyTo: snap };
        }
      }
      const outMessage = localId != null ? { ...enriched, localId } : enriched;
      emitToRoomRespectingFilters(
        io,
        groupId,
        "message",
        { groupId, message: outMessage },
        { authorUsername: outMessage?.username, message: outMessage }
      );

      if (user?.username) markActive(io, user.username);
    });

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

      queueAggregatedSystem(io, groupId, "leave", leavingUsername);

      py.removeGroupMember(groupId, leavingUsername).catch((err) =>
        console.warn(
          `[groupSocket] failed to persist group leave for ${leavingUsername} -> ${groupId}: ${
            err?.message || err
          }`
        )
      );

      broadcastOnlineCounts(io);
      broadcastPresenceOffline(io, leavingUsername);
    });

    socket.on("filters:refresh", async (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) return;
      const { groupId, includeHistory = false } = payload || {};
      const { map } = await refreshUserFilters(socket, user, true);
      const effectiveFilters = map || user.filtersByGroup || {};
      if (!includeHistory) return;
      const scopeId = typeof groupId === "string" ? groupId.trim() : "";
      if (!scopeId || scopeId.startsWith("dm:")) return;
      const isMember =
        Array.isArray(user.groups) && user.groups.includes(scopeId);
      if (!isMember) return;
      const history = await loadLatestHistory(scopeId);
      const filterBucket = getFilterBucket(effectiveFilters, scopeId);
      const filteredHistory = filterMessagesForScope(history, filterBucket);
      socket.emit("message-history", {
        groupId: scopeId,
        messages: filteredHistory,
      });
    });

    socket.on("edit-message", async (payload) => {
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
      const requestTarget = buildTargetPayload(payload, user.username);
      if (!groupId || !user.groups.includes(groupId) || !newText) {
        socket.emit("edit-error", {
          error: "Invalid data",
          groupId,
          target: requestTarget,
        });
        return;
      }
      let target = null;
      if (messageId) {
        target = await messageController.getMessageById(groupId, messageId);
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
        socket.emit("edit-error", {
          error: "Not allowed or message missing",
          groupId,
          target: buildTargetPayload(target, user.username) || requestTarget,
        });
        return;
      }
      const success = messageId
        ? await messageController.editMessageById(groupId, messageId, newText)
        : await messageController.editMessage(
            groupId,
            target.username,
            target.timestamp,
            newText
          );

      if (!success || success.success === false) {
        socket.emit("edit-error", {
          error: "Edit failed",
          groupId,
          target: buildTargetPayload(target, user.username) || requestTarget,
        });
        return;
      }

      emitToRoomRespectingFilters(
        io,
        groupId,
        "message-edited",
        {
          groupId,
          messageId: target.messageId,
          newText,
          lastEditedAt: success.lastEditedAt,
          edited: success.edited ?? true,
          originalTimestamp: target.timestamp,
          username: target.username,
        },
        {
          authorUsername: target?.username,
          timestamp: target?.timestamp,
        }
      );
    });

    socket.on("delete-message", async (payload) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "You must join a group first" });
        return;
      }
      const { messageId, groupId: providedGroupId, timestamp } = payload || {};
      const groupId = providedGroupId || user.activeGroupId;
      const requestTarget = buildTargetPayload(payload, user.username);
      if (!groupId || !user.groups.includes(groupId)) {
        socket.emit("delete-error", {
          error: "Invalid data",
          groupId,
          target: requestTarget,
        });
        return;
      }
      let target = null;
      if (messageId) {
        target = await messageController.getMessageById(groupId, messageId);
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
          groupId,
          target: buildTargetPayload(target, user.username) || requestTarget,
        });
        return;
      }
      const result = messageId
        ? await messageController.deleteMessageById(groupId, messageId)
        : await messageController.deleteMessage(
            groupId,
            target.username,
            target.timestamp
          );

      if ((result && result.success) || result === true) {
        const deletedAt =
          (result && result.deletedAt) || new Date().toISOString();

        emitToRoomRespectingFilters(
          io,
          groupId,
          "message-deleted",
          {
            groupId,
            messageId: target.messageId,
            timestamp: target.timestamp,
            username: target.username,
            deletedAt,
          },
          {
            authorUsername: target?.username,
            timestamp: target?.timestamp,
          }
        );
      } else {
        socket.emit("delete-error", {
          error: "Delete failed",
          groupId,
          target: buildTargetPayload(target, user.username) || requestTarget,
        });
      }
    });

    socket.on("react-message", async (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "You must join a group first" });
        return;
      }

      const { groupId: providedGroupId, messageId, timestamp, emoji } = payload;
      const groupId = providedGroupId || user.activeGroupId;
      const requestTarget = buildTargetPayload(payload, user.username);
      if (!groupId || !user.groups?.includes(groupId)) {
        socket.emit("reaction-error", {
          error: "Invalid group or not a member",
          groupId,
          target: requestTarget,
        });
        return;
      }

      if (emoji !== undefined && emoji !== null) {
        const isValid = typeof emoji === "string" && emoji.trim().length > 0;
        if (!isValid) {
          socket.emit("reaction-error", {
            error: "Invalid emoji",
            groupId,
            target: requestTarget,
          });
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
            groupId,
            target: requestTarget,
          });
          return;
        }
      } catch (e) {
        console.error("react-message failed:", e);
        socket.emit("reaction-error", {
          error: "Server error",
          groupId,
          target: requestTarget,
        });
        return;
      }

      if (!result || result.success !== true) {
        socket.emit("reaction-error", {
          error: result?.error || "Update failed",
          groupId,
          target:
            buildTargetPayload(
              {
                messageId: result?.messageId ?? messageId,
                timestamp,
                username: user.username,
              },
              user.username
            ) || requestTarget,
        });
        return;
      }

      io.to(groupId).emit("message-reaction", {
        groupId,
        messageId: result.messageId,
        summary: result.summary,
        reactions: result.reactions,
      });
    });

    socket.on("disconnect", () => {
      const user = userController.getUser(socket.id);
      if (!user) return;
      if (user.pendingDisconnect) return;

      user.pendingDisconnect = true;
      user.disconnectAt = Date.now();
      const usernameLc = (user.username || "").toLowerCase();
      try {
        const prev = pendingDisconnectByUser.get(usernameLc);
        if (prev) {
          try {
            clearTimeout(prev.timer);
          } catch {}
          pendingDisconnectByUser.delete(usernameLc);
        }
      } catch {}

      const timer = setTimeout(() => {
        const still = userController.getUser(socket.id);
        if (still && still.pendingDisconnect) {
          const groups = still.groups || [];
          const leavingUsername = still.username;
          const others = getSocketIdsForUsername(io, usernameLc).filter(
            (sid) => sid !== socket.id
          );
          userController.removeUser(socket.id);

          if (others.length === 0) {
            groups.forEach((g) => {
              socket
                .to(g)
                .emit("user-left", { groupId: g, username: leavingUsername });
              const list = userController.getUsersByGroup(g);
              io.to(g).emit("user-list", { groupId: g, users: list });

              queueAggregatedSystem(io, g, "leave", leavingUsername);
            });
            broadcastOnlineCounts(io);
            broadcastPresenceOffline(io, leavingUsername);
          }
        }
        try {
          pendingDisconnectByUser.delete(usernameLc);
        } catch {}
      }, GRACE_MS);
      pendingDisconnectByUser.set(usernameLc, {
        at: user.disconnectAt,
        socketId: socket.id,
        groups: Array.isArray(user.groups) ? user.groups.slice() : [],
        timer,
      });
      user._graceTimer = timer;
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

      userController.updateUser(socket.id, {
        username: newUsername,
        avatar: normalizedAvatar ?? null,
      });

      try {
        messageController.updateUserProfile(user.userId, {
          username: newUsername,
          avatar: normalizedAvatar ?? null,
        });
      } catch (e) {
        console.error("Failed updating historical messages for profile:", e);
      }

      (user.groups || []).forEach((g) => {
        const list = userController.getUsersByGroup(g);
        socket.to(g).emit("user-list", { groupId: g, users: list });
        socket.emit("user-list", { groupId: g, users: list });

        const evt = {
          groupId: g,
          userId: user.userId,
          username: newUsername,
          avatar: normalizedAvatar ?? null,
          oldUsername,
        };
        io.to(g).emit("user-profile-updated", evt);
      });

      if (oldUsername && newUsername && oldUsername !== newUsername) {
        const from = String(oldUsername).toLowerCase();
        const to = String(newUsername).toLowerCase();
        const last = lastActiveByUser.get(from);
        if (last) lastActiveByUser.set(to, last);
        if (activeUsers.has(from)) {
          activeUsers.delete(from);
          activeUsers.add(to);
        }
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
        socket.emit("error", { message: "Invalid like target" });
        return;
      }

      (async () => {
        try {
          await require("axios").default.post(
            `${
              process.env.PY_API_URL || "http://localhost:8081/api"
            }/dating/likes`,
            { from, to: toRaw }
          );
        } catch (e) {
          console.warn(
            "Failed to persist like via Python API:",
            e?.message || e
          );
        }
        const targetSockets = getSocketIdsForUsername(io, toLc);
        if (targetSockets.length) {
          const summary = await buildProfileSummaryForLike(from);
          io.to(targetSockets).emit("dating:liked", {
            from,
            profile: summary,
            at: Date.now(),
          });
        }
      })();
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

      (async () => {
        try {
          await require("axios").default.delete(
            `${
              process.env.PY_API_URL || "http://localhost:8081/api"
            }/dating/likes`,
            { data: { from, to: toRaw } }
          );
        } catch (e) {
          console.warn(
            "Failed to remove like via Python API:",
            e?.message || e
          );
        }
        const targetSockets = getSocketIdsForUsername(io, toLc);
        if (targetSockets.length) {
          io.to(targetSockets).emit("dating:unliked", { from, at: Date.now() });
        }
      })();
    });

    socket.on("dating:profile:update", (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }

      const rawProfile = payload?.profile;
      const payloadUsername =
        (rawProfile && rawProfile.username) ||
        payload?.username ||
        user.username;
      const requested = String(payloadUsername || "")
        .trim()
        .toLowerCase();
      const actor = String(user.username || "")
        .trim()
        .toLowerCase();

      if (!requested || requested !== actor) {
        return;
      }

      (async () => {
        let canonical = null;
        try {
          canonical = await py.getProfile(user.username);
        } catch (e) {
          console.warn(
            "Failed to fetch canonical dating profile:",
            e?.message || e
          );
        }

        const sanitized =
          sanitizeDatingProfilePayload(canonical) ||
          sanitizeDatingProfilePayload(rawProfile);
        if (!sanitized) return;

        if (!sanitized.username) {
          sanitized.username = user.username;
        }

        socket.broadcast.emit("dating:profile-updated", {
          username: sanitized.username,
          profile: sanitized,
          at: Date.now(),
        });
      })();
    });

    socket.on("report", (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }
      const { profileId, reason } = payload;

      if (typeof profileId !== "string" || profileId.length !== 24) {
        socket.emit("error", { message: "Invalid profile" });
        return;
      }

      socket.emit("reported", { profileId });
    });

    socket.on("view-profile", (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }
      const { profileId } = payload;

      if (typeof profileId !== "string" || profileId.length !== 24) {
        socket.emit("error", { message: "Invalid profile" });
        return;
      }

      socket.emit("profile-viewed", { profileId });
    });

    socket.on("get-matches", () => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }
      socket.emit("matches-data", { matches: [] });
    });

    socket.on("get-likes", () => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }
      socket.emit("likes-data", { likes: [] });
    });

    socket.on("get-blocks", () => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }
      socket.emit("blocks-data", { blocks: [] });
    });

    socket.on("get-reports", () => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }
      socket.emit("reports-data", { reports: [] });
    });

    socket.on("get-profile-views", () => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }
      socket.emit("profile-views-data", { views: [] });
    });

    socket.on("like-notification-ack", (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }
      const { profileId } = payload;

      if (typeof profileId !== "string" || profileId.length !== 24) {
        socket.emit("error", { message: "Invalid profile" });
        return;
      }

      socket.emit("like-notification-acknowledged", { profileId });
    });

    socket.on("super-like-notification-ack", (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }
      const { profileId } = payload;

      if (typeof profileId !== "string" || profileId.length !== 24) {
        socket.emit("error", { message: "Invalid profile" });
        return;
      }

      socket.emit("super-like-notification-acknowledged", { profileId });
    });

    socket.on("block-notification-ack", (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }
      const { profileId } = payload;

      if (typeof profileId !== "string" || profileId.length !== 24) {
        socket.emit("error", { message: "Invalid profile" });
        return;
      }

      socket.emit("block-notification-acknowledged", { profileId });
    });

    socket.on("report-notification-ack", (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }
      const { profileId } = payload;

      if (typeof profileId !== "string" || profileId.length !== 24) {
        socket.emit("error", { message: "Invalid profile" });
        return;
      }

      socket.emit("report-notification-acknowledged", { profileId });
    });

    socket.on("view-profile-notification-ack", (payload = {}) => {
      const user = userController.getUser(socket.id);
      if (!user || user.pendingDisconnect) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }
      const { profileId } = payload;

      if (typeof profileId !== "string" || profileId.length !== 24) {
        socket.emit("error", { message: "Invalid profile" });
        return;
      }

      socket.emit("view-profile-notification-acknowledged", { profileId });
    });
  });
}

module.exports = {
  setupGroupSocketHandlers,
};
