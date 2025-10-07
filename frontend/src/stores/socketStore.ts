import { create } from "zustand";
import { io, Socket } from "socket.io-client";
import { useAuthStore } from "./authStore";
import { useGroupStore } from "./groupStore";
import { useMessageStore } from "./messageStore";
import { useNotificationStore } from "./notificationStore";
import { usePresenceStore } from "./presenceStore";
import { useUiStore } from "./uiStore";
import { useLikesStore } from "./likesStore";
import { useAvatarStore } from "./avatarStore";
// NEW:
import { fetchProfilesByUsernames, fetchOnlineCounts } from "../services/api";
import { useDmThreadStore } from "./dmThreadStore";

// ADD: bring back type-only imports for TS
import type {
  Message,
  MessageMedia,
  ReactionEmoji,
  UserReaction,
} from "../types";

const BACKEND_URL = "http://localhost:8080";

interface SocketState {
  socket: Socket | null;
  isConnected: boolean;

  // Groups
  joinedGroupIds: Set<string>;
  activeGroupId: string | null;

  // DMs
  joinedDmIds: Set<string>;
  activeDmId: string | null;

  // Optimistic pending ops
  pendingEdits: Set<string>;
  pendingDeletes: Set<string>;

  // Lifecycle
  connect: () => void;
  ensureConnected: () => void;
  disconnect: () => void;
  hardReconnect: () => void;

  // Groups API
  joinGroup: (groupId: string, groupName: string) => void;
  leaveGroup: (groupId: string) => void;
  setActiveGroup: (groupId: string) => void;
  sendMessage: (
    text: string,
    replyTo: any | null,
    meta?: { kind?: "text" | "gif" | "media"; media?: MessageMedia }
  ) => void;
  editMessage: (originalMessage: any, newText: string) => void;
  deleteMessage: (message: any) => void;

  // DMs API
  joinDM: (dmId: string, peerName: string) => void;
  leaveDM: (dmId: string) => void;
  setActiveDM: (dmId: string | null) => void;
  sendDirectMessage: (
    text: string,
    replyTo: Message | null,
    meta?: {
      kind?: "text" | "gif" | "media";
      dmId?: string;
      media?: MessageMedia;
    }
  ) => void;
  editDirectMessage: (target: Message, newText: string) => void;
  deleteDirectMessage: (target: Message) => void;

  // Profile + reactions
  updateBubbleColor: (color: string) => void;
  updateProfile: (username: string, avatar: string | null) => void;
  reactToMessage: (message: Message, emoji: ReactionEmoji) => void;
  reactToDirectMessage: (message: Message, emoji: ReactionEmoji) => void;

  // Dating API
  likeUser: (targetUsername: string) => void;
  unlikeUser: (targetUsername: string) => void; // NEW
}

const keyFor = (m: any) =>
  m?.messageId ? `id:${m.messageId}` : `ts:${m?.username}|${m?.timestamp}`;

export const useSocketStore = create<SocketState>()((set, get) => ({
  socket: null,
  isConnected: false,

  // Groups
  joinedGroupIds: new Set<string>(),
  activeGroupId: null,

  // DMs
  joinedDmIds: new Set<string>(),
  activeDmId: null,

  // Optimistic ops
  pendingEdits: new Set<string>(),
  pendingDeletes: new Set<string>(),

  connect: () => {
    const { socket, isConnected } = get();
    const { username } = useAuthStore.getState();
    if (!username) return;
    if (socket && isConnected) return;

    const newSocket = io(BACKEND_URL, {
      withCredentials: true,
      autoConnect: true,
    });

    newSocket.on("connect", () => {
      set({ isConnected: true });

      // Register session for non-group features (dating likes)
      try {
        const { userId, username, avatar } = useAuthStore.getState();
        const bubbleColor = localStorage.getItem("chat-bubble-color") || null;
        if (username) {
          newSocket.emit("session:register", {
            userId,
            username,
            avatar,
            ...(bubbleColor ? { bubbleColor } : {}),
          });
        }
      } catch {}

      // Auto-rejoin last active group if any (existing)
      const { currentGroup } = useGroupStore.getState();
      if (currentGroup) {
        setTimeout(() => {
          try {
            get().joinGroup(currentGroup.id, currentGroup.name);
          } catch {}
        }, 100);
      }

      // Restore joined group ids from localStorage so Inbox can show them after restart
      try {
        const raw = localStorage.getItem("chat.joinedGroups");
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) {
            set({ joinedGroupIds: new Set(arr) });
          }
        }
      } catch {}

      // Proactively refresh online counts after reconnect (also persisted via groupStore)
      try {
        fetchOnlineCounts()
          .then((counts) => {
            const { mergeOnlineCounts } = useGroupStore.getState() as any;
            mergeOnlineCounts(counts || {});
          })
          .catch(() => {});
      } catch {}
    });
    newSocket.on("disconnect", () => set({ isConnected: false }));

    // Group message history
    newSocket.on("message-history", (payload) => {
      const { groupId, messages } = payload || {};
      if (groupId && Array.isArray(messages)) {
        useMessageStore.getState().setMessages(groupId, messages);
      }
    });

    // Group new message
    newSocket.on("message", (payload) => {
      const { groupId, message } = payload || {};
      if (groupId && message) {
        useMessageStore.getState().addMessage(groupId, message);

        // Skip notifications for system events (join/leave/info/notices)
        if (message.system) return;

        // Real-time unread increment if not actively viewing this group
        try {
          const { activeGroupId } = get();
          const { username } = useAuthStore.getState();
          const isSelf =
            message?.username && username && message.username === username;
          const isChatRoute =
            typeof window !== "undefined" &&
            window.location?.pathname === "/chat";

          if (!isSelf && (activeGroupId !== groupId || !isChatRoute)) {
            useNotificationStore.getState().inc(groupId, 1);
          }
        } catch {
          // noop
        }
      }
    });

    // Group edited
    newSocket.on("message-edited", (payload) => {
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

      // Clear pending edit
      const key = messageId
        ? `id:${messageId}`
        : `ts:${username}|${originalTimestamp}`;
      set((state) => {
        const next = new Set(state.pendingEdits);
        next.delete(key);
        return { pendingEdits: next };
      });

      // ...existing reconciliation logic...
      if (messageId) {
        useMessageStore.getState().editMessageById(groupId, messageId, newText);
        if (lastEditedAt) {
          const state = useMessageStore.getState();
          // same reconciliation as before
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

        // NEW: also update reply previews that reference this messageId
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

        // NEW: update reply previews by legacy timestamp+username match
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

    // Group deleted
    newSocket.on("message-deleted", (payload) => {
      const { groupId, messageId, deletedAt, timestamp, username } =
        payload || {};
      if (!groupId) return;
      // Clear pending delete
      const key = messageId ? `id:${messageId}` : `ts:${username}|${timestamp}`;
      set((state) => {
        const next = new Set(state.pendingDeletes);
        next.delete(key);
        return { pendingDeletes: next };
      });

      const store: any = useMessageStore.getState();
      if (messageId && store.markDeletedById) {
        store.markDeletedById(groupId, messageId, deletedAt);
      } else if (timestamp && username && store.markDeletedLegacy) {
        store.markDeletedLegacy(groupId, timestamp, username, deletedAt);
      }
    });

    // Group user list
    newSocket.on("user-list", (payload) => {
      const { groupId, users } = payload || {};
      const { currentGroup } = useGroupStore.getState();
      if (groupId && currentGroup?.id === groupId && Array.isArray(users)) {
        useGroupStore.getState().setOnlineUsers(users);

        // ADD THIS: if my entry has a normalized avatar, apply it to auth
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
        } catch {
          // ignore
        }

        // Cache all visible users' avatars for later use (DMs, etc.)
        try {
          const setAvatar = useAvatarStore.getState().setAvatar;
          for (const u of users) {
            if (u?.username) setAvatar(u.username, u.avatar ?? null);
          }
        } catch {}
      }
    });

    // Group online counts
    newSocket.on("online-counts", (counts: Record<string, number>) => {
      const { mergeOnlineCounts } = useGroupStore.getState() as any;
      mergeOnlineCounts(counts);
    });

    // Group bubble color changes
    newSocket.on("user-color-change", (payload) => {
      const { groupId, username, bubbleColor } = payload || {};
      if (!groupId || !username || !bubbleColor) return;
      const { updateBubbleColorForUser } = useMessageStore.getState() as any;
      updateBubbleColorForUser(groupId, username, bubbleColor);
    });

    // Group profile updated
    newSocket.on("user-profile-updated", (payload) => {
      const {
        groupId,
        userId,
        username: newUsername,
        avatar: newAvatar,
      } = payload || {};
      if (!groupId || !newUsername) return;

      // Update messages locally
      (useMessageStore.getState() as any).updateUserProfileForUser(
        groupId,
        userId || null,
        newUsername,
        newAvatar
      );

      // Update online users list in current group (light patch)
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

      // If this update is about me, sync the auth store so Header gets the absolute URL
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
          useAuthStore.getState().setAvatar(payload.avatar ?? null); // will be absolute http(s) or saved data URL
        }
      } catch {
        // ignore
      }
    });

    // Group reactions
    newSocket.on(
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

    // ----- Direct Messages (DM) handlers ----

    // DM history on join
    newSocket.on("dm:history", ({ dmId, messages }: any) => {
      if (!dmId || !Array.isArray(messages)) return;
      useMessageStore.getState().setMessages(dmId, messages);
      // Learn avatars from history
      try {
        const setFromMessage = useAvatarStore.getState().setFromMessage;
        for (const m of messages || []) {
          if (m?.username && m?.avatar) setFromMessage(m.username, m.avatar);
        }
      } catch {}
    });

    // DM threads snapshot on reconnect (persisted in Redis)
    newSocket.on("dm:threads", ({ threads }: any) => {
      try {
        if (!Array.isArray(threads) || !threads.length) return;
        const ms = useMessageStore.getState() as any;
        for (const t of threads) {
          const dmId = t?.dmId;
          if (!dmId || !String(dmId).startsWith("dm:")) continue;
          const last = t?.last;
          if (last && typeof last === "object") {
            const list = (ms.messages[dmId] || []) as any[];
            // if we don't already have this id, seed it to enable preview/time
            const exists = last.messageId
              ? list.some((m) => m.messageId === last.messageId)
              : false;
            if (!exists) {
              ms.setMessages(dmId, [...list, last]);
            }
          } else {
            if (!Array.isArray(ms.messages[dmId])) ms.setMessages(dmId, []);
          }
        }
      } catch {}
    });

    // DM participants info on join
    newSocket.on("dm:participants", ({ dmId, participants }: any) => {
      if (!dmId || !Array.isArray(participants)) return;
      try {
        const setAvatar = useAvatarStore.getState().setAvatar;
        for (const p of participants) {
          if (p?.username) setAvatar(p.username, p.avatar ?? null);
        }
      } catch {}
    });

    // DM new message
    newSocket.on("dm:message", (msg: any) => {
      const dmId = msg?.dmId;
      if (!dmId || !msg) return;

      // Learn avatar of the author
      try {
        if (msg.username && msg.avatar) {
          useAvatarStore.getState().setFromMessage(msg.username, msg.avatar);
        }
      } catch {}

      const ms = useMessageStore.getState() as any;
      const list = (ms.messages[dmId] || []) as Message[];

      // NEW: detect if we already have this messageId to avoid double-counting
      const alreadyHave = msg?.messageId
        ? list.some((m: any) => m.messageId === msg.messageId)
        : false;

      // If server echoes a message with a localId, replace our optimistic entry
      let replaced = false;
      if (msg.localId) {
        const idx = list.findIndex(
          (m: any) =>
            (m as any).localId === msg.localId ||
            (!m.messageId && m.username === msg.username && m.text === msg.text)
        );
        if (idx !== -1) {
          const next = list.slice();
          // Merge replyTo objects to retain client-side media/kind if server lacks them
          const merged = { ...list[idx], ...msg };
          if ((list[idx] as any)?.replyTo || (msg as any)?.replyTo) {
            merged.replyTo = {
              ...((list[idx] as any)?.replyTo || {}),
              ...((msg as any)?.replyTo || {}),
            };
          }
          next[idx] = merged;
          ms.setMessages(dmId, next);
          replaced = true;
        }
      }

      if (!replaced) {
        ms.addMessage(dmId, msg);
      }

      // If this DM thread was hidden and this message is newer than hiddenAt, unhide it
      const hiddenAt = useDmThreadStore.getState().getHiddenAt(dmId);
      const ts = ((): number => {
        const t = (msg as any).timestamp;
        if (typeof t === "number") return t > 0 && t < 1e12 ? t * 1000 : t;
        if (typeof t === "string") {
          const n = Number(t);
          if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
          const p = Date.parse(t);
          return Number.isFinite(p) ? p : 0;
        }
        return 0;
      })();
      if (hiddenAt != null && ts > hiddenAt) {
        useDmThreadStore.getState().unhide(dmId);
      }

      if (msg.system) return;

      try {
        const { activeDmId } = get();
        const { username } = useAuthStore.getState();
        const isSelf = msg?.username && username && msg.username === username;
        const isDMRoute =
          typeof window !== "undefined" &&
          window.location?.pathname.startsWith("/dm/");

        // NEW: only increment if it’s a new-to-this-client message
        if (!isSelf && (activeDmId !== dmId || !isDMRoute) && !alreadyHave) {
          useNotificationStore.getState().inc(dmId, 1);
        }
      } catch {}
    });

    // DM edited
    newSocket.on("dm:edit", (payload: any) => {
      const { dmId, target, newText, lastEditedAt, edited } = payload || {};
      if (!dmId || !target || !newText) return;

      const key = target.messageId
        ? `id:${target.messageId}`
        : `ts:${target.username}|${target.timestamp}`;
      set((state) => {
        const next = new Set(state.pendingEdits);
        next.delete(key);
        return { pendingEdits: next };
      });

      const ms = useMessageStore.getState() as any;
      const list = (ms.messages[dmId] || []) as Message[];
      const next = list.map((m: any) => {
        const same =
          (target.messageId && m.messageId === target.messageId) ||
          (!target.messageId &&
            m.username === target.username &&
            m.timestamp === target.timestamp);
        return same
          ? { ...m, text: newText, edited: edited ?? true, lastEditedAt }
          : m;
      });
      ms.setMessages(dmId, next);

      // NEW: also update reply previews that reference the edited message
      try {
        const ms2 = useMessageStore.getState() as any;
        const arr2 = (ms2.messages[dmId] || []) as any[];
        let changed = false;
        const patchById = !!target.messageId;
        const next2 = arr2.map((m) => {
          const rt = m?.replyTo as any;
          if (!rt) return m;
          const match = patchById
            ? rt.messageId === target.messageId
            : rt.username === target.username &&
              rt.timestamp === target.timestamp;
          if (match) {
            changed = true;
            return { ...m, replyTo: { ...rt, text: newText } };
          }
          return m;
        });
        if (changed) ms2.setMessages(dmId, next2);
      } catch {}
    });

    // DM deleted
    newSocket.on("dm:delete", (payload: any) => {
      const { dmId, target, deletedAt } = payload || {};
      if (!dmId || !target) return;

      const key = target.messageId
        ? `id:${target.messageId}`
        : `ts:${target.username}|${target.timestamp}`;
      set((state) => {
        const next = new Set(state.pendingDeletes);
        next.delete(key);
        return { pendingDeletes: next };
      });

      const ms = useMessageStore.getState() as any;
      const list = (ms.messages[dmId] || []) as Message[];
      const next = list.map((m: any) => {
        const same =
          (target.messageId && m.messageId === target.messageId) ||
          (!target.messageId &&
            m.username === target.username &&
            m.timestamp === target.timestamp);
        return same ? { ...m, deleted: true, deletedAt } : m;
      });
      ms.setMessages(dmId, next);
    });

    // DM delete error (permission or server failure)
    newSocket.on("dm:delete-error", (payload: any) => {
      try {
        const msg = (payload && payload.error) || "Delete failed";
        useUiStore.getState().showToast(msg, 2000);
      } catch {}
      // Best-effort: clear pending flag
      try {
        const { target } = payload || {};
        if (!target) return;
        const key = target.messageId
          ? `id:${target.messageId}`
          : `ts:${target.username}|${target.timestamp}`;
        set((state) => {
          const next = new Set(state.pendingDeletes);
          next.delete(key);
          return { pendingDeletes: next };
        });
      } catch {}
    });

    // DM reaction updates
    newSocket.on(
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

    // Presence events
    newSocket.on("presence:snapshot", (payload: any) => {
      const users = (payload && payload.users) || [];
      const last = (payload && payload.lastActive) || undefined;
      usePresenceStore.getState().setSnapshot(users, last);
    });
    newSocket.on("presence:online", ({ username, at }: any) => {
      usePresenceStore.getState().setOnline(username, at);
    });
    newSocket.on("presence:offline", ({ username, at }: any) => {
      usePresenceStore.getState().setOffline(username, at);
    });
    newSocket.on("presence:rename", ({ from, to }: any) => {
      usePresenceStore.getState().rename(from, to);
    });

    // dating like event -> incoming like
    newSocket.on("dating:liked", (payload: any) => {
      const { from, profile, at } = payload || {};
      if (!from || !profile) return;
      try {
        useLikesStore
          .getState()
          .upsertIncoming(
            from,
            { ...profile, username: profile.username || from },
            at
          );
      } catch {}
    });

    // NEW: dating unliked -> remove incoming
    newSocket.on("dating:unliked", (payload: any) => {
      const { from } = payload || {};
      if (!from) return;
      try {
        useLikesStore.getState().removeIncoming(from);
      } catch {}
    });

    // ADD: Presence activity pings
    let lastPing = 0;
    const PING_MIN_INTERVAL_MS = 800; // rate-limit frequent activity
    const HEARTBEAT_MS = 2000; // visible-page heartbeat

    const tryPing = () => {
      const now = Date.now();
      if (now - lastPing < PING_MIN_INTERVAL_MS) return;
      lastPing = now;
      try {
        newSocket.emit("presence:ping");
        const { username } = useAuthStore.getState();
        if (username) usePresenceStore.getState().touch(username, now);
      } catch {}
    };

    // Handlers to attach
    const onMouse = () => tryPing();
    const onKey = () => tryPing();
    const onTouch = () => tryPing();
    const onScroll = () => tryPing();
    const onFocus = () => tryPing();
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        tryPing();
      }
    };

    window.addEventListener("mousemove", onMouse, { passive: true });
    window.addEventListener("mousedown", onMouse, { passive: true });
    window.addEventListener("keydown", onKey, { passive: true } as any);
    window.addEventListener("touchstart", onTouch, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("focus", onFocus, true);
    document.addEventListener("visibilitychange", onVisibility);

    // Heartbeat while visible
    const hb = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      try {
        newSocket.emit("presence:ping");
      } catch {}
    }, HEARTBEAT_MS);

    // Store cleanup so we can remove on disconnect/reconnect
    (newSocket as any)._presenceCleanup = () => {
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("mousedown", onMouse);
      window.removeEventListener("keydown", onKey as any);
      window.removeEventListener("touchstart", onTouch);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("focus", onFocus, true);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(hb);
    };

    set({ socket: newSocket });

    if (typeof window !== "undefined") {
      const handleBeforeUnload = () => {
        try {
          (newSocket as any)._presenceCleanup?.();
          newSocket.disconnect();
        } catch {}
      };
      window.addEventListener("beforeunload", handleBeforeUnload);
      (newSocket as any)._cleanupUnload = handleBeforeUnload;
    }
  },

  ensureConnected: () => {
    if (!get().isConnected) get().connect();
  },

  hardReconnect: () => {
    const { socket } = get();
    if (socket) {
      if ((socket as any)._cleanupUnload) {
        window.removeEventListener(
          "beforeunload",
          (socket as any)._cleanupUnload
        );
      }
      (socket as any)._presenceCleanup?.();
      socket.removeAllListeners();
      socket.disconnect();
    }
    set({
      socket: null,
      isConnected: false,
      joinedGroupIds: new Set(),
      activeGroupId: null,
      joinedDmIds: new Set(),
      activeDmId: null,
    });
    try {
      localStorage.setItem("chat.joinedGroups", JSON.stringify([]));
    } catch {}
    get().connect();

    const { currentGroup } = useGroupStore.getState();
    if (currentGroup) {
      setTimeout(() => {
        get().joinGroup(currentGroup.id, currentGroup.name);
      }, 200);
    }
  },

  disconnect: () => {
    const { socket } = get();
    if (socket) {
      if ((socket as any)._cleanupUnload) {
        window.removeEventListener(
          "beforeunload",
          (socket as any)._cleanupUnload
        );
      }
      (socket as any)._presenceCleanup?.();
      socket.removeAllListeners();
      socket.disconnect();
    }
    set({
      socket: null,
      isConnected: false,
      joinedGroupIds: new Set(),
      activeGroupId: null,
      joinedDmIds: new Set(),
      activeDmId: null,
    });
    try {
      localStorage.setItem("chat.joinedGroups", JSON.stringify([]));
    } catch {}
  },

  // ----- Groups API ----

  joinGroup: (groupId, groupName) => {
    const { socket, isConnected, joinedGroupIds } = get();
    const { username, avatar, userId } = useAuthStore.getState();
    const customColor = localStorage.getItem("chat-bubble-color") || null;
    if (!username) return;

    if (!socket || !isConnected) {
      get().connect();
      setTimeout(() => get().joinGroup(groupId, groupName), 150);
      return;
    }

    if (!joinedGroupIds.has(groupId)) {
      socket.emit("join", {
        userId,
        username,
        avatar,
        ...(customColor ? { bubbleColor: customColor } : {}),
        groupId,
        groupName,
      });
      const newSet = new Set(joinedGroupIds);
      newSet.add(groupId);
      set({ joinedGroupIds: newSet, activeGroupId: groupId });
      try {
        localStorage.setItem(
          "chat.joinedGroups",
          JSON.stringify(Array.from(newSet))
        );
      } catch {}
    } else {
      socket.emit("get-users", { groupId });
      set({ activeGroupId: groupId });
    }
  },

  leaveGroup: (groupId) => {
    const { socket, joinedGroupIds, activeGroupId } = get();
    if (!socket || !joinedGroupIds.has(groupId)) return;
    socket.emit("leave", { groupId });
    const newSet = new Set(joinedGroupIds);
    newSet.delete(groupId);
    set({
      joinedGroupIds: newSet,
      activeGroupId: activeGroupId === groupId ? null : activeGroupId,
    });
    try {
      localStorage.setItem(
        "chat.joinedGroups",
        JSON.stringify(Array.from(newSet))
      );
    } catch {}
  },

  sendMessage: (text, replyTo, meta) => {
    const { socket, activeGroupId } = get();
    if (socket && activeGroupId && text.trim()) {
      const payload: any = {
        groupId: activeGroupId,
        text: text.trim(),
      };

      if (meta?.kind) payload.kind = meta.kind;
      if (meta?.media) payload.media = meta.media;

      if (replyTo?.messageId) {
        payload.replyToMessageId = replyTo.messageId;
      } else if (replyTo?.timestamp) {
        payload.replyToTimestamp = replyTo.timestamp;
      }

      socket.emit("message", payload);
      // Clear legacy messageStore replyTo if still used
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
    set((state) => {
      const next = new Set(state.pendingEdits);
      next.add(key);
      return { pendingEdits: next };
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

    const key = keyFor(message);
    set((state) => {
      const next = new Set(state.pendingDeletes);
      next.add(key);
      return { pendingDeletes: next };
    });

    const store: any = useMessageStore.getState();
    if (message.messageId && store.markDeletedById) {
      store.markDeletedById(
        activeGroupId,
        message.messageId,
        new Date().toISOString()
      );
    } else if (store.markDeletedLegacy) {
      store.markDeletedLegacy(
        activeGroupId,
        message.timestamp,
        message.username,
        new Date().toISOString()
      );
    }

    socket.emit("delete-message", {
      groupId: activeGroupId,
      messageId: message.messageId,
      timestamp: message.timestamp,
      username: message.username,
    });
  },

  setActiveGroup: (groupId: string) => {
    const { joinedGroupIds, socket } = get();
    if (joinedGroupIds.has(groupId)) {
      set({ activeGroupId: groupId });
      socket?.emit("get-users", { groupId });
      // Optional: if we're already on the chat route, clear unread
      try {
        const isChatRoute =
          typeof window !== "undefined" &&
          window.location?.pathname === "/chat";
        if (isChatRoute) {
          useNotificationStore.getState().reset(groupId);
        }
      } catch {}
    }
  },

  // ----- DMs API ----

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
      const isDMRoute =
        typeof window !== "undefined" &&
        window.location?.pathname.startsWith("/dm/");
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
    if (!socket || !dmId || !trimmed || !username) return;

    // Local temp id to reconcile with server echo
    const localId = `loc-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    const payload: any = {
      dmId,
      text: trimmed,
      username,
      // keep a client-side timestamp; server will replace with ISO timestamp
      timestamp: Date.now(),
      localId,
    };

    if (meta?.kind) payload.kind = meta.kind;
    if (meta?.media) payload.media = meta.media;

    if (replyTo?.messageId) {
      payload.replyToMessageId = replyTo.messageId;
    } else if (replyTo?.timestamp) {
      payload.replyToTimestamp = replyTo.timestamp;
    }

    // NEW: add a reply snapshot for optimistic preview (including GIF meta if present)
    if (replyTo) {
      payload.replyTo = {
        ...(replyTo.messageId ? { messageId: replyTo.messageId } : {}),
        username: replyTo.username,
        text: replyTo.text || "",
        timestamp: (replyTo as any).timestamp ?? null,
        ...((replyTo as any).kind ? { kind: (replyTo as any).kind } : {}),
        ...((replyTo as any).media ? { media: (replyTo as any).media } : {}),
      };
    }

    // Optimistic append with localId
    const ms = useMessageStore.getState();
    const list = ms.messages[dmId] || [];
    ms.setMessages(dmId, [...list, payload]);

    socket.emit("dm:message", payload);
  },

  editDirectMessage: (target, newText) => {
    const { socket } = get();
    const dmId = (target as any).dmId || get().activeDmId;
    if (!socket || !dmId) return;
    const trimmed = (newText || "").trim();
    if (!trimmed) return;

    const key = target.messageId
      ? `id:${target.messageId}`
      : `ts:${target.username}|${target.timestamp}`;

    set((state) => {
      const next = new Set(state.pendingEdits);
      next.add(key);
      return { pendingEdits: next };
    });

    // Optimistic local update
    const ms = useMessageStore.getState() as any;
    const arr = (ms.messages[dmId] || []) as Message[];
    const next = arr.map((m: any) => {
      const same =
        (target.messageId && m.messageId === target.messageId) ||
        (!target.messageId &&
          m.username === target.username &&
          m.timestamp === target.timestamp);
      return same ? { ...m, text: trimmed, edited: true } : m;
    });
    ms.setMessages(dmId, next);

    socket.emit("dm:edit", { dmId, target, newText: trimmed });
  },

  deleteDirectMessage: (target) => {
    const { socket } = get();
    const dmId = (target as any).dmId || get().activeDmId;
    if (!socket || !dmId || !target) return;

    const key = target.messageId
      ? `id:${target.messageId}`
      : `ts:${target.username}|${target.timestamp}`;

    set((state) => {
      const next = new Set(state.pendingDeletes);
      next.add(key);
      return { pendingDeletes: next };
    });

    // Optimistic local mark deleted
    const ms = useMessageStore.getState() as any;
    const arr = (ms.messages[dmId] || []) as Message[];
    const next = arr.map((m: any) => {
      const same =
        (target.messageId && m.messageId === target.messageId) ||
        (!target.messageId &&
          m.username === target.username &&
          m.timestamp === target.timestamp);
      return same
        ? { ...m, deleted: true, deletedAt: new Date().toISOString() }
        : m;
    });
    ms.setMessages(dmId, next);

    socket.emit("dm:delete", { dmId, target });
  },

  // ----- Profile + reactions ----

  updateBubbleColor: (color) => {
    const { socket } = get();
    if (socket) {
      socket.emit("update-bubble-color", color);
      localStorage.setItem("chat-bubble-color", color);
    }
  },

  updateProfile: (username, avatar) => {
    const { socket } = get();
    const auth = useAuthStore.getState();
    if (!socket || !auth.joined) return;
    socket.emit("update-profile", { username, avatar });
    // Optimistic local auth update
    useAuthStore.getState().setUsername(username);
    useAuthStore.getState().setAvatar(avatar);
  },

  reactToMessage: (message, emoji) => {
    const { socket, activeGroupId } = get();
    if (!socket || !activeGroupId || !message) return;

    // Optimistic local update so UI reflects reaction immediately
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
        // toggle: same emoji removes
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

  reactToDirectMessage: (message, emoji) => {
    const { socket, activeDmId } = get();
    const dmId = (message as any).dmId || activeDmId;
    if (!socket || !dmId || !message) return;

    // Optimistic DM reaction update
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
      timestamp: message.timestamp, // fallback
      emoji,
    };
    socket.emit("dm:react", payload);
  },

  // ----- Dating API ----

  likeUser: (targetUsername: string) => {
    const { socket, isConnected } = get();
    const { username } = useAuthStore.getState();
    const to = (targetUsername || "").trim();
    if (!to || !username) return;

    if (!socket || !isConnected) {
      get().connect();
      setTimeout(() => get().likeUser(targetUsername), 150);
      return;
    }
    if (to.toLowerCase() === username.toLowerCase()) {
      try {
        useUiStore.getState().showToast("You can’t like yourself", 2000);
      } catch {}
      return;
    }

    socket.emit("dating:like", { to });

    // Persist my outgoing like immediately and hydrate with real profile
    try {
      useLikesStore.getState().setOutgoing(to, true, Date.now());
      // Fetch the real profile and store for My Likes (no 404s)
      fetchProfilesByUsernames([to])
        .then((arr) => {
          const p = (arr && arr[0]) as any;
          if (!p) return;
          useLikesStore.getState().setOutgoingProfile(p.username || to, {
            username: p.username,
            age: p.age,
            gender: p.gender,
            mood: p.mood,
            photoUrl:
              (Array.isArray(p.photos) && p.photos[0]) || p.photoUrl || null,
            location: p.location || undefined,
          });
        })
        .catch(() => {
          // ignore fetch errors; card will hydrate via batch later
        });
    } catch {}
  },

  // Unlike remains the same
  unlikeUser: (targetUsername: string) => {
    const { socket, isConnected } = get();
    const { username } = useAuthStore.getState();
    const to = (targetUsername || "").trim();
    if (!to || !username) return;

    if (!socket || !isConnected) {
      get().connect();
      setTimeout(() => get().unlikeUser(targetUsername), 150);
      return;
    }
    if (to.toLowerCase() === username.toLowerCase()) return;

    socket.emit("dating:unlike", { to });

    try {
      useLikesStore.getState().setOutgoing(to, false);
    } catch {}
  },
}));
