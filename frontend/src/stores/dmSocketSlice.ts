import type { StoreApi } from "zustand";
import type { Socket } from "socket.io-client";
import type { SocketState, DirectMessageSocketSlice } from "./socketTypes";
import { useAuthStore } from "./authStore";
import { useMessageStore } from "./messageStore";
import { useNotificationStore } from "./notificationStore";
import { useUiStore } from "./uiStore";
import { useAvatarStore } from "./avatarStore";
import { useDmThreadStore } from "./dmThreadStore";
import { useTypingStore } from "./typingStore";
import { currentRouteStartsWith } from "../utils/routes.ts";
import type { Message, UserReaction } from "../types";

const keyForTarget = (target: any) =>
  target?.messageId
    ? `id:${target.messageId}`
    : `ts:${target?.username}|${target?.timestamp}`;

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

export const createDmSocketSlice = (
  set: StoreApi<SocketState>["setState"],
  get: StoreApi<SocketState>["getState"]
): DirectMessageSocketSlice => ({
  joinedDmIds: new Set<string>(),
  activeDmId: null,

  joinDM: (dmId, peerName) => {
    const { socket, isConnected, joinedDmIds } = get();
    const { username, avatar, userId } = useAuthStore.getState();
    const customColor = localStorage.getItem("chat-bubble-color") || null;
    if (!username) return;

    if (!socket || !isConnected) {
      get().connect();
      setTimeout(() => get().joinDM(dmId, peerName), 150);
      return;
    }

    if (!joinedDmIds.has(dmId)) {
      socket.emit("dm:join", {
        userId,
        username,
        avatar,
        ...(customColor ? { bubbleColor: customColor } : {}),
        dmId,
        peerName,
      });
      const next = new Set(joinedDmIds);
      next.add(dmId);
      set({ joinedDmIds: next, activeDmId: dmId });
    } else {
      set({ activeDmId: dmId });
    }
  },

  leaveDM: (dmId) => {
    const { socket, joinedDmIds, activeDmId } = get();
    if (!socket || !joinedDmIds.has(dmId)) return;
    socket.emit("dm:leave", { dmId });
    const next = new Set(joinedDmIds);
    next.delete(dmId);
    set({
      joinedDmIds: next,
      activeDmId: activeDmId === dmId ? null : activeDmId,
    });
  },

  setActiveDM: (dmId) => {
    set({ activeDmId: dmId });
    try {
      const isDMRoute = currentRouteStartsWith("/dm/");
      if (isDMRoute && dmId) {
        useNotificationStore.getState().reset(dmId);
      }
    } catch {}
  },

  sendDirectMessage: (text, replyTo, meta) => {
    const { socket } = get();
    const { username } = useAuthStore.getState();
    const dmId = meta?.dmId || get().activeDmId;
    const trimmed = (text || "").trim();
    const isAudio = meta?.kind === "audio" && Boolean(meta?.audio?.url);
    const isMedia = meta?.kind === "media" && Boolean(meta?.media);
    if (!socket || !dmId || (!trimmed && !isAudio && !isMedia) || !username)
      return;

    const providedLocalId = meta?.localId;
    const localId = providedLocalId
      ? providedLocalId
      : `loc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    let normalizedReply: any = replyTo || null;
    if (normalizedReply && !normalizedReply.messageId) {
      try {
        const list = (useMessageStore.getState() as any).messages[
          dmId
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
      dmId,
      text: isAudio ? "" : trimmed,
      username,
      timestamp: Date.now(),
      localId,
    };

    if (meta?.kind) payload.kind = meta.kind;
    if (meta?.media) payload.media = meta.media;
    if (meta?.audio) payload.audio = meta.audio;

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
      if ((normalizedReply as any).kind)
        snapshot.kind = (normalizedReply as any).kind;
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

    const ms = useMessageStore.getState() as any;
    const list = (ms.messages[dmId] || []) as any[];
    const targetIdx = providedLocalId
      ? list.findIndex((m: any) => (m as any).localId === providedLocalId)
      : -1;

    if (targetIdx !== -1) {
      const next = list.slice();
      const current = next[targetIdx] || {};
      const updatedMedia = meta?.media
        ? { ...(meta.media as any), uploading: false }
        : current.media;
      const updatedAudio = meta?.audio
        ? {
            ...(current.audio || {}),
            ...meta.audio,
            uploading: false,
          }
        : current.audio;
      next[targetIdx] = {
        ...current,
        text: payload.text,
        username,
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
      ms.setMessages(dmId, next);
    } else {
      const optimisticPayload = {
        ...payload,
        ...(meta?.kind ? { kind: meta.kind } : {}),
        ...(meta?.media
          ? { media: { ...(meta.media as any), uploading: false } }
          : {}),
        ...(meta?.audio
          ? {
              audio: {
                ...(meta.audio as any),
                uploading: false,
              },
            }
          : {}),
      };
      ms.setMessages(dmId, [...list, optimisticPayload]);
    }

    socket.emit("dm:message", payload);
  },

  editDirectMessage: (target, newText) => {
    const { socket } = get();
    const dmId = (target as any).dmId || get().activeDmId;
    if (!socket || !dmId) return;
    const trimmed = (newText || "").trim();
    if (!trimmed) return;

    const key = keyForTarget(target);

    let snapshot: any = null;
    try {
      const ms = useMessageStore.getState() as any;
      const list = (ms.messages[dmId] || []) as any[];
      if (Array.isArray(list) && list.length) {
        if ((target as any)?.messageId) {
          snapshot = list.find(
            (m: any) => m.messageId === (target as any).messageId
          );
        } else if ((target as any)?.timestamp && (target as any)?.username) {
          snapshot = list.find(
            (m: any) =>
              m.timestamp === (target as any).timestamp &&
              m.username === (target as any).username
          );
        }
      }
    } catch {}
    if (!snapshot && target) snapshot = target;
    if (snapshot) {
      const cloned = cloneMessageSnapshot(snapshot);
      if (cloned) {
        cloned.dmId = cloned.dmId || dmId;
        snapshot = cloned;
      }
    }

    set((state) => {
      const nextEdits = new Set(state.pendingEdits);
      nextEdits.add(key);
      const nextSnapshots = new Map(state.pendingEditSnapshots);
      if (snapshot && !nextSnapshots.has(key)) {
        nextSnapshots.set(key, {
          scopeId: dmId,
          scopeType: "dm",
          message: snapshot,
        });
      }
      return {
        pendingEdits: nextEdits,
        pendingEditSnapshots: nextSnapshots,
      };
    });

    const ms = useMessageStore.getState() as any;
    const arr = (ms.messages[dmId] || []) as Message[];
    const next = arr.map((m: any) => {
      const same =
        (target as any)?.messageId && m.messageId === (target as any).messageId
          ? true
          : !(target as any)?.messageId &&
            m.username === (target as any).username &&
            m.timestamp === (target as any).timestamp;
      return same ? { ...m, text: trimmed, edited: true } : m;
    });
    ms.setMessages(dmId, next);

    socket.emit("dm:edit", { dmId, target, newText: trimmed });
  },

  deleteDirectMessage: (target) => {
    const { socket } = get();
    const dmId = (target as any).dmId || get().activeDmId;
    if (!socket || !dmId || !target) return;

    const key = keyForTarget(target);

    let snapshot: any = null;
    try {
      const ms = useMessageStore.getState() as any;
      const list = (ms.messages[dmId] || []) as any[];
      if (Array.isArray(list) && list.length) {
        if ((target as any)?.messageId) {
          snapshot = list.find(
            (m: any) => m.messageId === (target as any).messageId
          );
        } else if ((target as any)?.timestamp && (target as any)?.username) {
          snapshot = list.find(
            (m: any) =>
              m.timestamp === (target as any).timestamp &&
              m.username === (target as any).username
          );
        }
      }
    } catch {}
    if (!snapshot) snapshot = target;
    if (snapshot) {
      const cloned = cloneMessageSnapshot(snapshot);
      if (cloned) {
        cloned.dmId = cloned.dmId || dmId;
        snapshot = cloned;
      }
    }

    set((state) => {
      const nextDeletes = new Set(state.pendingDeletes);
      nextDeletes.add(key);
      const nextSnapshots = new Map(state.pendingDeleteSnapshots);
      if (snapshot && !nextSnapshots.has(key)) {
        nextSnapshots.set(key, {
          scopeId: dmId,
          scopeType: "dm",
          message: snapshot,
        });
      }
      return {
        pendingDeletes: nextDeletes,
        pendingDeleteSnapshots: nextSnapshots,
      };
    });

    const ms = useMessageStore.getState() as any;
    const arr = (ms.messages[dmId] || []) as Message[];
    const next = arr.map((m: any) => {
      const same =
        (target as any)?.messageId && m.messageId === (target as any).messageId
          ? true
          : !(target as any)?.messageId &&
            m.username === (target as any).username &&
            m.timestamp === (target as any).timestamp;
      return same
        ? {
            ...m,
            deleted: true,
            deletedAt: new Date().toISOString(),
            text: "",
            media: undefined,
            audio: undefined,
          }
        : m;
    });
    ms.setMessages(dmId, next);

    socket.emit("dm:delete", { dmId, target });
  },

  reactToDirectMessage: (message, emoji) => {
    const { socket, activeDmId } = get();
    const dmId = (message as any).dmId || activeDmId;
    if (!socket || !dmId || !message) return;

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
        const list = (ms.messages[dmId] || []) as any[];
        const target = list.find((m) => m.messageId === message.messageId);
        const current = (target?.reactions as any) || {};
        const next = { ...current };
        if (next[my.userId]?.emoji === emoji || !emoji) delete next[my.userId];
        else next[my.userId] = my;
        ms.updateMessageReactionsById(dmId, message.messageId, next);
      } else if (message.timestamp && message.username) {
        const list = (ms.messages[dmId] || []) as any[];
        const target = list.find(
          (m) =>
            m.timestamp === message.timestamp && m.username === message.username
        );
        const current = (target?.reactions as any) || {};
        const next = { ...current };
        if (next[my.userId]?.emoji === emoji || !emoji) delete next[my.userId];
        else next[my.userId] = my;
        ms.updateMessageReactionsLegacy(
          dmId,
          message.timestamp,
          message.username,
          next
        );
      }
    } catch {}

    const payload: any = {
      dmId,
      messageId: message.messageId,
      timestamp: message.timestamp,
      emoji,
    };
    socket.emit("dm:react", payload);
  },

  notifyDmTyping: (dmId, typing, opts) => {
    const { socket, isConnected } = get();
    const { username } = useAuthStore.getState();
    const scopeId = (dmId || "").trim();
    if (!socket || !isConnected || !scopeId || !username) return;

    const at =
      typeof opts?.at === "number" && Number.isFinite(opts.at)
        ? opts.at
        : Date.now();
    const ttlMs =
      typeof opts?.ttlMs === "number" && Number.isFinite(opts.ttlMs)
        ? Math.max(0, opts.ttlMs)
        : undefined;

    const payload: Record<string, unknown> = {
      dmId: scopeId,
      typing: Boolean(typing),
      at,
    };
    if (ttlMs != null) payload.ttlMs = ttlMs;

    socket.emit("dm:typing", payload);
  },
});

export const registerDmSocketHandlers = (
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
    if (!entry || entry.scopeType !== "dm") return;
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

  on("dm:history", ({ dmId, messages }: any) => {
    if (!dmId || !Array.isArray(messages)) return;
    useMessageStore.getState().setMessages(dmId, messages);
    try {
      const setFromMessage = useAvatarStore.getState().setFromMessage;
      for (const m of messages || []) {
        if (m?.username && m?.avatar) setFromMessage(m.username, m.avatar);
      }
    } catch {}
  });

  on("dm:threads", ({ threads }: any) => {
    try {
      if (!Array.isArray(threads) || !threads.length) return;
      const ms = useMessageStore.getState() as any;
      const authUsername = (
        useAuthStore.getState().username || ""
      ).toLowerCase();
      for (const t of threads) {
        const dmId = t?.dmId;
        if (!dmId || !String(dmId).startsWith("dm:")) continue;
        const last = t?.last;
        if (last && typeof last === "object") {
          const list = (ms.messages[dmId] || []) as any[];
          const exists = last.messageId
            ? list.some((m) => m.messageId === last.messageId)
            : false;
          if (!exists) {
            ms.setMessages(dmId, [...list, last]);
            const authorLc = String(last?.username || "").toLowerCase();
            if (authorLc && authorLc !== authUsername) {
              const { activeDmId } = get();
              const onDmRoute = currentRouteStartsWith("/dm/");
              if (activeDmId !== dmId || !onDmRoute) {
                try {
                  useNotificationStore.getState().inc(dmId, 1);
                } catch {}
              }
            }
          }
        } else {
          if (!Array.isArray(ms.messages[dmId])) ms.setMessages(dmId, []);
        }
      }
    } catch {}
  });

  on("dm:participants", ({ dmId, participants }: any) => {
    if (!dmId || !Array.isArray(participants)) return;
    try {
      const setAvatar = useAvatarStore.getState().setAvatar;
      for (const p of participants) {
        if (!p?.username) continue;
        setAvatar(p.username, p.avatar === undefined ? undefined : p.avatar);
      }
    } catch {}
  });

  on("dm:message", (msg: any) => {
    const dmId = msg?.dmId;
    if (!dmId || !msg) return;

    try {
      if (msg.username && msg.avatar) {
        useAvatarStore.getState().setFromMessage(msg.username, msg.avatar);
      }
    } catch {}

    const ms = useMessageStore.getState() as any;
    const list = (ms.messages[dmId] || []) as Message[];

    const alreadyHave = msg?.messageId
      ? list.some((m: any) => m.messageId === msg.messageId)
      : false;

    let replaced = false;
    if (msg.localId) {
      const idx = list.findIndex(
        (m: any) =>
          (m as any).localId === msg.localId ||
          (!m.messageId && m.username === msg.username && m.text === msg.text)
      );
      if (idx !== -1) {
        const next = list.slice();
        const merged = { ...list[idx], ...msg } as any;
        if ((list[idx] as any)?.replyTo || (msg as any)?.replyTo) {
          merged.replyTo = {
            ...((list[idx] as any)?.replyTo || {}),
            ...((msg as any)?.replyTo || {}),
          };
        }
        if ((list[idx] as any)?.media || (msg as any)?.media) {
          const prevMedia = ((list[idx] as any)?.media || {}) as any;
          const nextMedia = ((msg as any)?.media || {}) as any;
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
            (!nextMedia?.preview || nextMedia.preview === nextMedia.original) &&
            typeof prevMedia.preview === "string" &&
            prevMedia.preview.startsWith("data:")
          ) {
            mergedMedia.preview = prevMedia.preview;
          }

          mergedMedia.uploading = false;
          merged.media = mergedMedia as any;
        }
        next[idx] = merged;
        ms.setMessages(dmId, next);
        replaced = true;
      }
    }

    if (!replaced) {
      ms.addMessage(dmId, msg);
    }

    const hiddenAt = useDmThreadStore.getState().getHiddenAt(dmId);
    const ts = (() => {
      const t = (msg as any).timestamp;
      if (typeof t === "number") return t > 0 && t < 1e12 ? t * 1000 : t;
      if (typeof t === "string") {
        const n = Number(t);
        if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
        const parsed = Date.parse(t);
        return Number.isFinite(parsed) ? parsed : 0;
      }
      return 0;
    })();
    if (hiddenAt != null && ts > hiddenAt) {
      useDmThreadStore.getState().unhide(dmId);
    }

    if (isSystemMessage(msg)) return;

    try {
      const { activeDmId } = get();
      const { username } = useAuthStore.getState();
      const isSelf = msg?.username && username && msg.username === username;
      const isDMRoute = currentRouteStartsWith("/dm/");

      if (!isSelf && (activeDmId !== dmId || !isDMRoute) && !alreadyHave) {
        useNotificationStore.getState().inc(dmId, 1);
      }
    } catch {}
  });

  on("dm:edit-error", (payload: any) => {
    const message = (payload && payload.error) || "Edit failed";
    const key = payload?.target
      ? keyForTarget(payload.target)
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

  on("dm:delete-error", (payload: any) => {
    const message = (payload && payload.error) || "Delete failed";
    const key = payload?.target
      ? keyForTarget(payload.target)
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

  on(
    "dm:reaction",
    ({
      dmId,
      messageId,
      reactions,
    }: {
      dmId: string;
      messageId: string;
      reactions: Record<string, UserReaction>;
    }) => {
      if (!dmId || !messageId) return;
      (useMessageStore.getState() as any).updateMessageReactionsById(
        dmId,
        messageId,
        reactions || {}
      );
    }
  );

  on("dm:typing", (payload: any) => {
    const { dmId, username, typing, at, ttlMs } = payload || {};
    if (!dmId || !username) return;
    const myUsername = (useAuthStore.getState().username || "").toLowerCase();
    const incomingLc = String(username || "").toLowerCase();
    if (myUsername && incomingLc === myUsername) return;

    const ttl =
      typeof ttlMs === "number" && Number.isFinite(ttlMs) && ttlMs > 0
        ? ttlMs
        : undefined;
    const timestamp =
      typeof at === "number" && Number.isFinite(at) ? at : undefined;

    useTypingStore
      .getState()
      .setTyping(dmId, username, Boolean(typing), ttl, timestamp);
  });

  on("dm:edit", (payload: any) => {
    const { dmId, target, newText, lastEditedAt, edited } = payload || {};
    if (!dmId || !target || !newText) return;

    const key = keyForTarget(target);
    popPendingEditSnapshot(key);

    const ms = useMessageStore.getState() as any;
    const list = (ms.messages[dmId] || []) as Message[];
    const next = list.map((m: any) => {
      const same =
        (target as any)?.messageId && m.messageId === (target as any).messageId
          ? true
          : !(target as any)?.messageId &&
            m.username === (target as any).username &&
            m.timestamp === (target as any).timestamp;
      return same
        ? { ...m, text: newText, edited: edited ?? true, lastEditedAt }
        : m;
    });
    ms.setMessages(dmId, next);

    try {
      const ms2 = useMessageStore.getState() as any;
      const arr2 = (ms2.messages[dmId] || []) as any[];
      let changed = false;
      const patchById = Boolean((target as any)?.messageId);
      const next2 = arr2.map((m) => {
        const rt = m?.replyTo as any;
        if (!rt) return m;
        const match = patchById
          ? rt.messageId === (target as any).messageId
          : rt.username === (target as any).username &&
            rt.timestamp === (target as any).timestamp;
        if (match) {
          changed = true;
          return { ...m, replyTo: { ...rt, text: newText } };
        }
        return m;
      });
      if (changed) ms2.setMessages(dmId, next2);
    } catch {}
  });

  on("dm:delete", (payload: any) => {
    const { dmId, target, deletedAt } = payload || {};
    if (!dmId || !target) return;

    const key = keyForTarget(target);
    popPendingDeleteSnapshot(key);

    const ms = useMessageStore.getState() as any;
    const list = (ms.messages[dmId] || []) as Message[];
    const next = list.map((m: any) => {
      const same =
        (target as any)?.messageId && m.messageId === (target as any).messageId
          ? true
          : !(target as any)?.messageId &&
            m.username === (target as any).username &&
            m.timestamp === (target as any).timestamp;
      return same
        ? {
            ...m,
            deleted: true,
            deletedAt,
            text: "",
            media: undefined,
            audio: undefined,
          }
        : m;
    });
    ms.setMessages(dmId, next);
  });

  on("dm:reaction-error", (payload: any) => {
    const message = (payload && payload.error) || "Reaction failed";
    try {
      useUiStore.getState().showToast(message, 2000);
    } catch {}
  });

  on("reply-warn", (payload: any) => {
    const message =
      (payload && payload.warning) || "Reply target could not be found";
    try {
      useUiStore.getState().showToast(message, 2000);
    } catch {}
  });

  return () => {
    handlers.forEach(([event, handler]) => {
      socket.off(event, handler);
    });
  };
};
