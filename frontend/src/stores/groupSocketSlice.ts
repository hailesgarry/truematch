import type { StoreApi } from "zustand";
import type { Socket } from "socket.io-client";
import type { SocketState, GroupSocketSlice } from "./socketTypes";
import { useAuthStore } from "./authStore";
import { useGroupStore } from "./groupStore";
import { useMessageStore } from "./messageStore";
import { useNotificationStore } from "./notificationStore";
import { useUiStore } from "./uiStore";
import { useMessageFilterStore } from "./messageFilterStore";
import { useAvatarStore } from "./avatarStore";
import { currentRouteStartsWith } from "../utils/routes.ts";
import { queryClient } from "../lib/queryClient";
import type { Group, Message, UserReaction } from "../types";

const keyFor = (m: any) =>
  m?.messageId ? `id:${m.messageId}` : `ts:${m?.username}|${m?.timestamp}`;

export const initialJoinedGroups: Set<string> = (() => {
  try {
    const raw = localStorage.getItem("chat.joinedGroups");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray(parsed.groups)
      ) {
        return new Set(parsed.groups);
      }
    }
  } catch {}
  return new Set<string>();
})();

const cloneMessageSnapshot = (value: any) => {
  if (!value || typeof value !== "object") return null;
  try {
    const cloner = (globalThis as any).structuredClone;
    if (typeof cloner === "function") {
      return cloner(value);
    }
  } catch {}
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { ...value };
  }
};

export const createGroupSocketSlice = (
  set: StoreApi<SocketState>["setState"],
  get: StoreApi<SocketState>["getState"]
): GroupSocketSlice => ({
  joinedGroupIds: initialJoinedGroups,
  activeGroupId: null,
  ensuredGroupIdsForSocket: new Set<string>(),

  joinGroup: (groupId, groupName) => {
    const { socket, isConnected, joinedGroupIds, ensuredGroupIdsForSocket } =
      get();
    const { username, avatar, userId } = useAuthStore.getState();
    const customColor = localStorage.getItem("chat-bubble-color") || null;
    if (!username) return;

    if (!socket || !isConnected) {
      get().connect();
      setTimeout(() => get().joinGroup(groupId, groupName), 150);
      return;
    }

    if (!ensuredGroupIdsForSocket.has(groupId)) {
      socket.emit("join", {
        userId,
        username,
        avatar,
        ...(customColor ? { bubbleColor: customColor } : {}),
        groupId,
        groupName,
      });
      const nextEnsured = new Set(ensuredGroupIdsForSocket);
      nextEnsured.add(groupId);
      set({ ensuredGroupIdsForSocket: nextEnsured });
    } else {
      socket.emit("get-users", { groupId });
    }

    if (!joinedGroupIds.has(groupId)) {
      const newSet = new Set(joinedGroupIds);
      newSet.add(groupId);
      set({ joinedGroupIds: newSet, activeGroupId: groupId });
      try {
        const userId = useAuthStore.getState().userId;
        localStorage.setItem(
          "chat.joinedGroups",
          JSON.stringify({ userId, groups: Array.from(newSet) })
        );
      } catch {}
      // Ensure downstream member previews and counts refresh promptly
      queryClient.invalidateQueries({ queryKey: ["home", "groups"] });
    } else {
      set({ activeGroupId: groupId });
    }
  },

  leaveGroup: (groupId) => {
    const { socket, isConnected, joinedGroupIds, activeGroupId } = get();
    if (!joinedGroupIds.has(groupId)) return;

    if (!socket || !isConnected) {
      get().connect();
      setTimeout(() => get().leaveGroup(groupId), 150);
      return;
    }

    socket.emit("leave", { groupId });
    const newSet = new Set(joinedGroupIds);
    newSet.delete(groupId);
    set({
      joinedGroupIds: newSet,
      activeGroupId: activeGroupId === groupId ? null : activeGroupId,
    });
    try {
      const userId = useAuthStore.getState().userId;
      localStorage.setItem(
        "chat.joinedGroups",
        JSON.stringify({ userId, groups: Array.from(newSet) })
      );
    } catch {}
    // Invalidate groups query to refresh member previews
    queryClient.invalidateQueries({ queryKey: ["home", "groups"] });
  },

  setActiveGroup: (groupId: string) => {
    const { joinedGroupIds, socket } = get();
    if (joinedGroupIds.has(groupId)) {
      set({ activeGroupId: groupId });
      socket?.emit("get-users", { groupId });
      try {
        const isChatRoute = currentRouteStartsWith("/chat");
        if (isChatRoute) {
          useNotificationStore.getState().reset(groupId);
        }
      } catch {}
    }
  },

  sendMessage: (text, replyTo, meta) => {
    const { socket, activeGroupId } = get();
    const providedLocalId = meta?.localId;
    const isAudio = meta?.kind === "audio" && Boolean(meta?.audio?.url);
    if (socket && activeGroupId && (text.trim() || isAudio)) {
      const localId = providedLocalId
        ? providedLocalId
        : `loc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      let normalizedReply: any = replyTo || null;
      if (normalizedReply && !normalizedReply.messageId) {
        try {
          const list = (useMessageStore.getState() as any).messages[
            activeGroupId
          ] as any[];
          if (Array.isArray(list) && list.length) {
            const found = list.find(
              (m) =>
                (normalizedReply.timestamp &&
                  m.timestamp === normalizedReply.timestamp &&
                  (!normalizedReply.username ||
                    m.username === normalizedReply.username)) ||
                m === normalizedReply
            );
            if (found?.messageId) {
              normalizedReply = {
                ...normalizedReply,
                messageId: found.messageId,
              };
            }
          }
        } catch {}
      }

      const payload: any = {
        groupId: activeGroupId,
        text: isAudio ? "" : text.trim(),
        localId,
      };

      if (meta?.kind) payload.kind = meta.kind;
      if (meta?.media) payload.media = meta.media;
      if (isAudio && meta?.audio) payload.audio = meta.audio;

      if (normalizedReply) {
        if (!normalizedReply.messageId) {
          try {
            useUiStore
              .getState()
              .showToast("Can’t reply: missing message id", 2000);
          } catch {}
          return;
        }
        payload.replyToMessageId = normalizedReply.messageId;
      }

      if (normalizedReply) {
        const snapshot: any = {
          ...(normalizedReply.messageId
            ? { messageId: normalizedReply.messageId }
            : {}),
          username: normalizedReply.username,
          text: normalizedReply.text || "",
          timestamp: (normalizedReply as any).timestamp ?? null,
        };
        if ((normalizedReply as any).kind) {
          snapshot.kind = (normalizedReply as any).kind;
        }
        if ((normalizedReply as any).deleted) {
          snapshot.deleted = true;
          if ((normalizedReply as any).deletedAt) {
            snapshot.deletedAt = (normalizedReply as any).deletedAt;
          }
          snapshot.text = "";
        }
        const replyMedia = (normalizedReply as any).media;
        const replyAudio = (normalizedReply as any).audio;
        if (replyMedia) snapshot.media = replyMedia;
        if (replyAudio) snapshot.audio = replyAudio;
        payload.replyTo = snapshot;
      }

      try {
        const auth = useAuthStore.getState();
        const ms = useMessageStore.getState() as any;
        const list = (ms.messages[activeGroupId] || []) as any[];
        const targetIdx = providedLocalId
          ? list.findIndex((m: any) => (m as any).localId === providedLocalId)
          : -1;

        if (targetIdx !== -1) {
          const next = list.slice();
          const current = next[targetIdx] || {};
          const updatedAudio =
            isAudio && meta?.audio
              ? {
                  ...(current.audio || {}),
                  ...meta.audio,
                  uploading: false,
                }
              : current.audio;
          const updatedMedia = meta?.media
            ? { ...(meta.media as any), uploading: false }
            : current.media;
          const updatedMessage = {
            ...current,
            text: payload.text,
            ...(meta?.kind ? { kind: meta.kind } : {}),
            ...(updatedMedia ? { media: updatedMedia } : {}),
            ...(updatedAudio ? { audio: updatedAudio } : {}),
            ...(() => {
              if (!payload.replyTo) return {};
              const mergedReply: any = {
                ...(current.replyTo || {}),
                ...payload.replyTo,
              };
              if (payload.replyTo.deleted) {
                mergedReply.text = "";
              }
              return { replyTo: mergedReply };
            })(),
          };
          next[targetIdx] = updatedMessage;
          ms.setMessages(activeGroupId, next);
        } else {
          const optimistic: any = {
            localId,
            username: auth.username,
            text: payload.text,
            timestamp: Date.now(),
            ...(meta?.kind ? { kind: meta.kind } : {}),
            ...(meta?.media ? { media: meta.media } : {}),
            ...(isAudio && meta?.audio
              ? { audio: { ...meta.audio, uploading: false } }
              : {}),
            ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
          };
          ms.setMessages(activeGroupId, [...list, optimistic]);
        }
      } catch {}

      socket.emit("message", payload);
      try {
        useMessageStore.getState().setReplyTo(null);
      } catch {}
    }
  },

  editMessage: (originalMessage, newText) => {
    const { socket, activeGroupId } = get();
    if (!socket || !activeGroupId) return;
    const trimmed = (newText || "").trim();
    if (!trimmed) return;

    const key = keyFor(originalMessage);

    let snapshot: any = null;
    if (activeGroupId) {
      try {
        const ms = useMessageStore.getState() as any;
        const list = (ms.messages[activeGroupId] || []) as any[];
        if (Array.isArray(list) && list.length) {
          if (originalMessage?.messageId) {
            snapshot = list.find(
              (m: any) => m.messageId === originalMessage.messageId
            );
          } else if (originalMessage?.timestamp && originalMessage?.username) {
            snapshot = list.find(
              (m: any) =>
                m.timestamp === originalMessage.timestamp &&
                m.username === originalMessage.username
            );
          }
        }
      } catch {}
    }
    if (!snapshot && originalMessage) snapshot = originalMessage;
    const clonedSnapshot = cloneMessageSnapshot(snapshot);

    set((state) => {
      const nextEdits = new Set(state.pendingEdits);
      nextEdits.add(key);
      const nextSnapshots = new Map(state.pendingEditSnapshots);
      if (clonedSnapshot && !nextSnapshots.has(key)) {
        nextSnapshots.set(key, {
          scopeId: activeGroupId,
          scopeType: "group",
          message: clonedSnapshot,
        });
      }
      return {
        pendingEdits: nextEdits,
        pendingEditSnapshots: nextSnapshots,
      };
    });

    if (originalMessage?.messageId) {
      const { editMessageById } = useMessageStore.getState() as any;
      editMessageById(activeGroupId, originalMessage.messageId, trimmed);
    } else {
      useMessageStore
        .getState()
        .editMessage(
          activeGroupId,
          originalMessage.timestamp,
          originalMessage.username,
          trimmed
        );
    }

    socket.emit("edit-message", {
      groupId: activeGroupId,
      messageId: originalMessage.messageId,
      timestamp: originalMessage.timestamp,
      newText: trimmed,
    });
  },

  deleteMessage: (message) => {
    const { socket, activeGroupId } = get();
    if (!socket || !activeGroupId || !message) return;

    const store: any = useMessageStore.getState();
    const list = (store.messages?.[activeGroupId] || []) as any[];

    const resolved =
      list.find((m: any) => m === message) ||
      (message.localId
        ? list.find(
            (m: any) =>
              m?.localId && message.localId && m.localId === message.localId
          )
        : undefined) ||
      (message.messageId
        ? list.find(
            (m: any) =>
              m?.messageId &&
              message.messageId &&
              m.messageId === message.messageId
          )
        : undefined) ||
      list.find(
        (m: any) =>
          (m?.username || "") === (message.username || "") &&
          String(m?.timestamp ?? "") === String(message.timestamp ?? "")
      ) ||
      null;

    const target: any = resolved || message;
    const localId = target?.localId ?? (message as any)?.localId ?? null;
    let messageId = target?.messageId ?? message?.messageId ?? null;
    messageId = messageId ? String(messageId) : null;
    let timestamp: string | null = null;
    const rawTs = target?.timestamp ?? message?.timestamp ?? null;
    if (typeof rawTs === "string" && rawTs.length > 0) {
      timestamp = rawTs;
    } else if (typeof rawTs === "number" && Number.isFinite(rawTs)) {
      try {
        timestamp = new Date(rawTs).toISOString();
      } catch {
        timestamp = null;
      }
    }
    const username = target?.username ?? message?.username;

    if (!messageId && !timestamp) {
      if (localId) {
        try {
          useUiStore
            .getState()
            .showToast("Message is still sending; try again in a moment", 2200);
        } catch {}
        return;
      }
      return;
    }

    const key = messageId
      ? `id:${messageId}`
      : `ts:${username ?? ""}|${timestamp ?? ""}`;

    const snapshot = target ? cloneMessageSnapshot(target) : null;

    set((state) => {
      const nextDeletes = new Set(state.pendingDeletes);
      nextDeletes.add(key);
      const nextSnapshots = new Map(state.pendingDeleteSnapshots);
      if (snapshot && !nextSnapshots.has(key)) {
        nextSnapshots.set(key, {
          scopeId: activeGroupId,
          scopeType: "group",
          message: snapshot,
        });
      }
      return {
        pendingDeletes: nextDeletes,
        pendingDeleteSnapshots: nextSnapshots,
      };
    });

    const deletedAt = new Date().toISOString();
    if (messageId && store.markDeletedById) {
      store.markDeletedById(activeGroupId, messageId, deletedAt);
    } else if (timestamp && username && store.markDeletedLegacy) {
      store.markDeletedLegacy(activeGroupId, timestamp, username, deletedAt);
    }

    socket.emit("delete-message", {
      groupId: activeGroupId,
      ...(messageId ? { messageId } : {}),
      ...(timestamp ? { timestamp } : {}),
      username,
    });
  },

  reactToMessage: (message: Message, emoji) => {
    const { socket, activeGroupId } = get();
    if (!socket || !activeGroupId || !message) return;

    try {
      const ms = useMessageStore.getState() as any;
      const auth = useAuthStore.getState();
      const my = {
        userId: auth.userId || "",
        username: auth.username || "",
        emoji,
        at: Date.now(),
      } as any;
      if (message.messageId) {
        const current = (message.reactions as any) || {};
        const next = { ...current };
        if (next[my.userId]?.emoji === emoji || !emoji) {
          delete next[my.userId];
        } else {
          next[my.userId] = my;
        }
        ms.updateMessageReactionsById(activeGroupId, message.messageId, next);
      } else if (message.timestamp && message.username) {
        const list =
          (useMessageStore.getState() as any).messages[activeGroupId] || [];
        const target = list.find(
          (m: any) =>
            m.timestamp === message.timestamp && m.username === message.username
        );
        const current = (target?.reactions as any) || {};
        const next = { ...current };
        if (next[my.userId]?.emoji === emoji || !emoji) delete next[my.userId];
        else next[my.userId] = my;
        ms.updateMessageReactionsLegacy(
          activeGroupId,
          message.timestamp,
          message.username,
          next
        );
      }
    } catch {}

    const payload: any = {
      groupId: activeGroupId,
      messageId: message.messageId,
      timestamp: message.timestamp,
      emoji,
    };
    socket.emit("react-message", payload);
  },
});

export const registerGroupSocketHandlers = (
  socket: Socket,
  set: StoreApi<SocketState>["setState"],
  get: StoreApi<SocketState>["getState"],
  utils: { isSystemMessage: (m: any) => boolean }
): (() => void) => {
  const { isSystemMessage } = utils;
  const handlers: Array<[string, (...args: any[]) => void]> = [];
  const on = (event: string, handler: (...args: any[]) => void) => {
    socket.on(event, handler);
    handlers.push([event, handler]);
  };

  const popPendingEditSnapshot = (key: string | null) => {
    if (!key) return null;
    let snapshot: any;
    set((state) => {
      const nextEdits = new Set(state.pendingEdits);
      nextEdits.delete(key);
      const nextSnapshots = new Map(state.pendingEditSnapshots);
      snapshot = nextSnapshots.get(key);
      if (snapshot) nextSnapshots.delete(key);
      return {
        pendingEdits: nextEdits,
        pendingEditSnapshots: nextSnapshots,
      } as Partial<SocketState>;
    });
    return snapshot || null;
  };

  const popPendingDeleteSnapshot = (key: string | null) => {
    if (!key) return null;
    let snapshot: any;
    set((state) => {
      const nextDeletes = new Set(state.pendingDeletes);
      nextDeletes.delete(key);
      const nextSnapshots = new Map(state.pendingDeleteSnapshots);
      snapshot = nextSnapshots.get(key);
      if (snapshot) nextSnapshots.delete(key);
      return {
        pendingDeletes: nextDeletes,
        pendingDeleteSnapshots: nextSnapshots,
      } as Partial<SocketState>;
    });
    return snapshot || null;
  };

  const restoreSnapshot = (entry: any) => {
    if (!entry || entry.scopeType !== "group") return;
    const { scopeId, message } = entry;
    if (!scopeId || !message) return;
    try {
      const ms = useMessageStore.getState() as any;
      const list = (ms.messages[scopeId] || []) as any[];
      const matcher = message.messageId
        ? (m: any) => m.messageId === message.messageId
        : (m: any) =>
            String(m.timestamp ?? "") === String(message.timestamp ?? "") &&
            m.username === message.username;
      const idx = Array.isArray(list) ? list.findIndex(matcher) : -1;
      if (idx !== -1) {
        const next = list.slice();
        next[idx] = message;
        ms.setMessages(scopeId, next);
      } else if (Array.isArray(list)) {
        ms.setMessages(scopeId, [...list, message]);
      }
    } catch {}
  };

  on("message-history", (payload) => {
    const { groupId, messages } = payload || {};
    if (groupId && Array.isArray(messages)) {
      useMessageStore.getState().setMessages(groupId, messages);
    }
  });

  on("message", (payload) => {
    const { groupId, message } = payload || {};
    if (
      message &&
      (typeof (message as any).then === "function" ||
        (typeof message === "object" &&
          !message.messageId &&
          !message.text &&
          message.username &&
          message.username !== "system"))
    ) {
      return;
    }
    if (groupId && message) {
      const ms = useMessageStore.getState() as any;
      const list = (ms.messages[groupId] || []) as any[];

      let replaced = false;
      const { username: selfName } = useAuthStore.getState();
      const isSelf = selfName && (message as any)?.username === selfName;
      if ((message as any).localId) {
        const idx = list.findIndex(
          (m: any) =>
            (m as any).localId === (message as any).localId ||
            (!m.messageId &&
              m.username === (message as any).username &&
              m.text === (message as any).text)
        );
        if (idx !== -1) {
          const next = list.slice();
          const merged = { ...list[idx], ...message };
          if ((list[idx] as any)?.replyTo || (message as any)?.replyTo) {
            merged.replyTo = {
              ...((list[idx] as any)?.replyTo || {}),
              ...((message as any)?.replyTo || {}),
            };
          }
          if ((list[idx] as any)?.media || (message as any)?.media) {
            const prevMedia = ((list[idx] as any)?.media || {}) as any;
            const nextMedia = ((message as any)?.media || {}) as any;
            const mergedMedia: Record<string, unknown> = {
              ...prevMedia,
              ...nextMedia,
            };

            if (
              prevMedia?.placeholder &&
              !nextMedia?.placeholder &&
              typeof prevMedia.placeholder === "string"
            ) {
              mergedMedia.placeholder = prevMedia.placeholder;
            }

            if (
              prevMedia?.preview &&
              (!nextMedia?.preview ||
                nextMedia.preview === nextMedia.original) &&
              typeof prevMedia.preview === "string" &&
              prevMedia.preview.startsWith("data:")
            ) {
              mergedMedia.preview = prevMedia.preview;
            }

            mergedMedia.uploading = false;
            merged.media = mergedMedia as any;
          }
          next[idx] = merged;
          ms.setMessages(groupId, next);
          replaced = true;
        }
      }

      if (!replaced && (message as any).messageId) {
        const exists = list.some(
          (m: any) => m.messageId && m.messageId === (message as any).messageId
        );
        if (exists) replaced = true;
      }

      if (!replaced && isSelf) {
        const idx = list.findIndex((m: any) => {
          const noId = !m.messageId;
          const sameText = (m.text || "").trim() === (message as any).text;
          const sameKind = (m.kind || "text") === (message as any).kind;
          const bothMedia = Boolean(m.media) || Boolean((message as any).media);
          const sameMedia = bothMedia
            ? JSON.stringify(m.media || {}) ===
              JSON.stringify((message as any).media || {})
            : true;
          const sameReply =
            (m.replyTo?.messageId || null) ===
            ((message as any).replyTo?.messageId ||
              (message as any).replyToMessageId ||
              null);
          return noId && sameText && sameKind && sameMedia && sameReply;
        });
        if (idx !== -1) {
          const next = list.slice();
          const merged = { ...list[idx], ...message };
          next[idx] = merged;
          ms.setMessages(groupId, next);
          replaced = true;
        }
      }

      if (!replaced) {
        ms.addMessage(groupId, message);
      }

      if (isSystemMessage(message)) return;

      try {
        const { activeGroupId } = get();
        const { username } = useAuthStore.getState();
        const isSelfMsg =
          (message as any)?.username &&
          username &&
          (message as any).username === username;
        const isChatRoute = currentRouteStartsWith("/chat");

        if (!isSelfMsg && (activeGroupId !== groupId || !isChatRoute)) {
          useNotificationStore.getState().inc(groupId, 1);
        }
      } catch {}
    }
  });

  on("filters:snapshot", (payload) => {
    try {
      useMessageFilterStore.getState().syncFromSnapshot(payload);
    } catch (e) {
      console.warn("filters:snapshot handler failed", e);
    }
  });

  on("message-reconcile", (payload: any) => {
    const { groupId, optimisticId, realId, message } = payload || {};
    if (!groupId || !optimisticId || !realId || !message) return;
    try {
      (useMessageStore.getState() as any).reconcileSystemMessage(
        groupId,
        optimisticId,
        message
      );
    } catch {}
  });

  on("message-edited", (payload) => {
    const {
      groupId,
      messageId,
      newText,
      lastEditedAt,
      edited,
      originalTimestamp,
      username,
    } = payload || {};
    if (!groupId || !newText) return;

    const key = messageId
      ? `id:${messageId}`
      : `ts:${username}|${originalTimestamp}`;
    popPendingEditSnapshot(key);

    if (messageId) {
      useMessageStore.getState().editMessageById(groupId, messageId, newText);
      if (lastEditedAt) {
        const state = useMessageStore.getState();
        const arr = state.messages[groupId] || [];
        const idx = arr.findIndex((m: any) => m.messageId === messageId);
        if (idx !== -1) {
          arr[idx] = {
            ...arr[idx],
            text: newText,
            edited: edited ?? true,
            lastEditedAt,
          };
          state.setMessages(groupId, arr);
        }
      }

      on("edit-error", (payload: any) => {
        const message = (payload && payload.error) || "Edit failed";
        const key = payload?.target
          ? keyFor(payload.target)
          : payload?.messageId
          ? `id:${payload.messageId}`
          : payload?.timestamp && payload?.username
          ? `ts:${payload.username}|${payload.timestamp}`
          : null;
        const snapshot = popPendingEditSnapshot(key);
        if (snapshot) restoreSnapshot(snapshot);
        try {
          useUiStore.getState().showToast(message, 2000);
        } catch {}
      });
      try {
        const state = useMessageStore.getState() as any;
        const list = (state.messages[groupId] || []) as any[];
        let changed = false;
        const next = list.map((m) => {
          if (m?.replyTo?.messageId === messageId) {
            changed = true;
            return { ...m, replyTo: { ...m.replyTo, text: newText } };
          }
          return m;
        });
        if (changed) state.setMessages(groupId, next);
      } catch {}
    } else if (originalTimestamp && username) {
      useMessageStore
        .getState()
        .editMessage(groupId, originalTimestamp, username, newText);

      try {
        const state = useMessageStore.getState() as any;
        const list = (state.messages[groupId] || []) as any[];
        let changed = false;
        const next = list.map((m) => {
          const rt = m?.replyTo as any;
          if (
            rt &&
            rt.timestamp === originalTimestamp &&
            rt.username === username
          ) {
            changed = true;
            return { ...m, replyTo: { ...rt, text: newText } };
          }
          return m;
        });
        if (changed) state.setMessages(groupId, next);
      } catch {}
    }
  });

  on("message-deleted", (payload) => {
    const { groupId, messageId, deletedAt, timestamp, username } =
      payload || {};
    if (!groupId) return;
    const key = messageId ? `id:${messageId}` : `ts:${username}|${timestamp}`;
    popPendingDeleteSnapshot(key);

    const store: any = useMessageStore.getState();
    if (messageId && store.markDeletedById) {
      store.markDeletedById(groupId, messageId, deletedAt);
    } else if (timestamp && username && store.markDeletedLegacy) {
      store.markDeletedLegacy(groupId, timestamp, username, deletedAt);
    }
  });

  on("delete-error", (payload: any) => {
    const message = (payload && payload.error) || "Delete failed";
    const key = payload?.target
      ? keyFor(payload.target)
      : payload?.messageId
      ? `id:${payload.messageId}`
      : payload?.timestamp && payload?.username
      ? `ts:${payload.username}|${payload.timestamp}`
      : null;
    const snapshot = popPendingDeleteSnapshot(key);
    if (snapshot) restoreSnapshot(snapshot);
    try {
      useUiStore.getState().showToast(message, 2000);
    } catch {}
  });

  on("reaction-error", (payload: any) => {
    const message = (payload && payload.error) || "Reaction failed";
    try {
      useUiStore.getState().showToast(message, 2000);
    } catch {}
  });

  on("user-list", (payload) => {
    const { groupId, users } = payload || {};
    const { currentGroup } = useGroupStore.getState();
    if (groupId && currentGroup?.id === groupId && Array.isArray(users)) {
      useGroupStore.getState().setOnlineUsers(users);

      try {
        const auth = useAuthStore.getState();
        const me = users.find(
          (u: any) =>
            (auth.userId && u.userId === auth.userId) ||
            (u.username &&
              auth.username &&
              u.username.toLowerCase() === auth.username.toLowerCase())
        );
        if (me && me.avatar && me.avatar !== auth.avatar) {
          useAuthStore.getState().setAvatar(me.avatar);
        }
      } catch {}

      try {
        const setAvatar = useAvatarStore.getState().setAvatar;
        for (const u of users) {
          if (!u?.username) continue;
          setAvatar(u.username, u.avatar === undefined ? undefined : u.avatar);
        }
      } catch {}
    }

    if (!groupId || !Array.isArray(users)) return;

    const preview = users
      .slice(0, 6)
      .map((u: any) => {
        const username = typeof u?.username === "string" ? u.username : "";
        if (!username) return null;
        const avatar =
          u?.avatar === null
            ? null
            : typeof u?.avatar === "string"
            ? u.avatar
            : null;
        const userId =
          typeof u?.userId === "string" && u.userId.trim() ? u.userId : null;
        return { username, avatar, userId };
      })
      .filter(Boolean) as NonNullable<Group["memberPreview"]>;

    const total = users.length;

    useGroupStore.setState((state) => {
      const matches = (g: any) =>
        g && (g.id === groupId || g.databaseId === groupId);
      let changed = false;

      const updateGroup = (g: any) => {
        if (!matches(g)) return g;
        changed = true;
        return {
          ...g,
          memberPreview: preview,
          memberCount: total,
        };
      };

      const nextGroups = state.groups.map(updateGroup);
      const nextCurrent = state.currentGroup
        ? updateGroup(state.currentGroup)
        : null;

      if (!changed) return {};
      return { groups: nextGroups, currentGroup: nextCurrent };
    });
  });

  on("online-counts", (counts: Record<string, number>) => {
    const { mergeOnlineCounts } = useGroupStore.getState() as any;
    mergeOnlineCounts(counts);
  });

  on("user-color-change", (payload) => {
    const { groupId, username, bubbleColor } = payload || {};
    if (!groupId || !username || !bubbleColor) return;
    const { updateBubbleColorForUser } = useMessageStore.getState() as any;
    updateBubbleColorForUser(groupId, username, bubbleColor);
  });

  on("user-profile-updated", (payload) => {
    const {
      groupId,
      userId,
      username: newUsername,
      avatar: newAvatar,
    } = payload || {};
    if (!groupId || !newUsername) return;

    (useMessageStore.getState() as any).updateUserProfileForUser(
      groupId,
      userId || null,
      newUsername,
      newAvatar
    );

    const { currentGroup, onlineUsers, setOnlineUsers } =
      useGroupStore.getState();
    if (
      currentGroup &&
      currentGroup.id === groupId &&
      Array.isArray(onlineUsers)
    ) {
      const patched = onlineUsers.map((u: any) =>
        (userId && u.userId === userId) ||
        u.username === (payload as any).oldUsername
          ? { ...u, username: newUsername, avatar: newAvatar }
          : u
      );
      setOnlineUsers(patched);
    }

    try {
      const auth = useAuthStore.getState();
      const myUserId = auth.userId;
      const isMe =
        (payload.userId && myUserId && payload.userId === myUserId) ||
        (!payload.userId &&
          typeof payload.username === "string" &&
          typeof auth.username === "string" &&
          payload.username.toLowerCase() === auth.username.toLowerCase());

      if (isMe) {
        useAuthStore.getState().setUsername(payload.username);
        useAuthStore.getState().setAvatar(payload.avatar ?? null);
      }
    } catch {}
  });

  on(
    "message-reaction",
    ({
      groupId,
      messageId,
      reactions,
    }: {
      groupId: string;
      messageId: string;
      reactions: Record<string, UserReaction>;
    }) => {
      if (!groupId || !messageId) return;
      (useMessageStore.getState() as any).updateMessageReactionsById(
        groupId,
        messageId,
        reactions || {}
      );
    }
  );

  return () => {
    handlers.forEach(([event, handler]) => {
      socket.off(event, handler);
    });
  };
};
