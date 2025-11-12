import { create } from "zustand";
import { io } from "socket.io-client";
import { useAuthStore } from "./authStore";
import { useGroupStore } from "./groupStore";
import { usePresenceStore } from "./presenceStore";
import { useUiStore } from "./uiStore";
import { useLikesStore } from "./likesStore";
// NEW:
import { fetchProfilesByUsernames, API_URL } from "../services/api";
import { queryClient } from "../lib/queryClient";
import { datingProfilesKey } from "../hooks/useDatingProfilesQuery";
import { broadcastMessage } from "../lib/broadcast";
import {
  createGroupSocketSlice,
  registerGroupSocketHandlers,
} from "./groupSocketSlice";
import { createDmSocketSlice, registerDmSocketHandlers } from "./dmSocketSlice";
import type { PendingMessageSnapshot, SocketState } from "./socketTypes";
import type { DatingProfile } from "../types";

// Helper: robust system message detection (username 'system' or system flag/type)
function isSystemMessage(m: any): boolean {
  if (!m) return false;
  if (m.system === true) return true;
  if (typeof m.systemType === "string" && m.systemType.length > 0) return true;
  const u = typeof m.username === "string" ? m.username.toLowerCase() : "";
  return u === "system" || u === "_system";
}

// Socket base URL: prefer explicit Vite env, else follow API_URL's origin, else localhost
const SOCKET_URL =
  (import.meta as any)?.env?.VITE_SOCKET_URL?.toString?.() ||
  (import.meta as any)?.env?.VITE_NODE_URL?.toString?.() ||
  (() => {
    try {
      const apiOrigin = new URL(API_URL).origin; // may point to Python if VITE_PY_API_URL used
      // Heuristic: if API_URL points to Python default 8081, prefer 8080 for sockets
      if (/^http:\/\/localhost:8081$/i.test(apiOrigin))
        return "http://localhost:8080";
      return apiOrigin;
    } catch {
      return "http://localhost:8080";
    }
  })();

export const useSocketStore = create<SocketState>()((set, get) => {
  const groupSlice = createGroupSocketSlice(set, get);
  const dmSlice = createDmSocketSlice(set, get);

  return {
    ...groupSlice,
    ...dmSlice,
    socket: null,
    isConnected: false,

    // Optimistic ops
    pendingEdits: new Set<string>(),
    pendingDeletes: new Set<string>(),
    pendingEditSnapshots: new Map<string, PendingMessageSnapshot>(),
    pendingDeleteSnapshots: new Map<string, PendingMessageSnapshot>(),

    connect: () => {
      const { socket, isConnected } = get();
      const { username } = useAuthStore.getState();
      if (!username) return;
      if (socket && isConnected) return;

      const newSocket = io(SOCKET_URL, {
        withCredentials: true,
        autoConnect: true,
      });

      newSocket.on("connect", () => {
        set({ isConnected: true, ensuredGroupIdsForSocket: new Set<string>() });

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

        // Removed auto-rejoin here to avoid duplicate joins; pages will call joinGroup explicitly

        // Restore joined group ids from localStorage so Inbox can show them after restart
        try {
          const { userId } = useAuthStore.getState();
          const raw = localStorage.getItem("chat.joinedGroups");
          if (raw) {
            const parsed = JSON.parse(raw);
            if (
              parsed &&
              typeof parsed === "object" &&
              Array.isArray(parsed.groups)
            ) {
              if (parsed.userId === userId) {
                set({ joinedGroupIds: new Set(parsed.groups) });
              } else {
                // Different user, clear
                localStorage.setItem(
                  "chat.joinedGroups",
                  JSON.stringify({ userId, groups: [] })
                );
              }
            }
          }
        } catch {}

        // Online counts deprecated; no immediate refresh required on connect
      });
      newSocket.on("disconnect", () => set({ isConnected: false }));

      const detachGroupHandlers = registerGroupSocketHandlers(
        newSocket,
        set,
        get,
        { isSystemMessage }
      );
      (newSocket as any)._detachGroupHandlers = detachGroupHandlers;
      const detachDmHandlers = registerDmSocketHandlers(newSocket, set, get, {
        isSystemMessage,
      });
      (newSocket as any)._detachDmHandlers = detachDmHandlers;

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

      // Dating profile updates propagated from server
      newSocket.on("dating:profile-updated", (payload: any) => {
        const rawProfile = payload?.profile;
        const usernameFromPayload =
          typeof payload?.username === "string" ? payload.username : null;
        const usernameFromProfile =
          rawProfile && typeof rawProfile.username === "string"
            ? rawProfile.username
            : null;
        const username = (
          usernameFromPayload ||
          usernameFromProfile ||
          ""
        ).trim();
        if (!rawProfile || typeof rawProfile !== "object" || !username) {
          return;
        }
        const usernameLower = username.toLowerCase();
        const usernameQueryKey = `username:${usernameLower}`;

        try {
          const userIdFromProfile =
            typeof rawProfile?.userId === "string"
              ? rawProfile.userId.trim()
              : "";
          if (userIdFromProfile) {
            queryClient.setQueryData(
              ["datingProfile", userIdFromProfile],
              rawProfile
            );
          }
          queryClient.setQueryData(["datingProfile", username], rawProfile);
          queryClient.setQueryData(
            ["datingProfile", usernameQueryKey],
            rawProfile
          );
        } catch {}

        queryClient
          .invalidateQueries({ queryKey: datingProfilesKey })
          .catch(() => {});
        broadcastMessage("tm:dating", { type: "dating:invalidate" });
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
            (newSocket as any)._detachGroupHandlers?.();
            (newSocket as any)._detachDmHandlers?.();
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
        (socket as any)._detachGroupHandlers?.();
        (socket as any)._detachDmHandlers?.();
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
        ensuredGroupIdsForSocket: new Set<string>(),
        pendingEdits: new Set<string>(),
        pendingDeletes: new Set<string>(),
        pendingEditSnapshots: new Map<string, PendingMessageSnapshot>(),
        pendingDeleteSnapshots: new Map<string, PendingMessageSnapshot>(),
      });
      try {
        const { userId } = useAuthStore.getState();
        localStorage.setItem(
          "chat.joinedGroups",
          JSON.stringify({ userId, groups: [] })
        );
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
        (socket as any)._detachGroupHandlers?.();
        (socket as any)._detachDmHandlers?.();
        (socket as any)._presenceCleanup?.();
        socket.removeAllListeners();
        socket.disconnect();
      }
      // On soft disconnect, preserve joinedGroupIds so UI doesn't flash empty
      set({
        socket: null,
        isConnected: false,
        activeGroupId: null,
        joinedDmIds: new Set(),
        activeDmId: null,
        ensuredGroupIdsForSocket: new Set<string>(),
        pendingEdits: new Set<string>(),
        pendingDeletes: new Set<string>(),
        pendingEditSnapshots: new Map<string, PendingMessageSnapshot>(),
        pendingDeleteSnapshots: new Map<string, PendingMessageSnapshot>(),
      });
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

    broadcastDatingProfileUpdate: (profile: DatingProfile) => {
      if (!profile || typeof profile !== "object") return;
      const username =
        typeof profile.username === "string" ? profile.username.trim() : "";
      if (!username) return;
      const usernameLower = username.toLowerCase();
      const usernameQueryKey = `username:${usernameLower}`;

      // Ensure local cache reflects newest profile immediately
      try {
        const profileUserId =
          typeof profile.userId === "string" ? profile.userId.trim() : "";
        if (profileUserId) {
          queryClient.setQueryData(["datingProfile", profileUserId], profile);
        }
        queryClient.setQueryData(["datingProfile", username], profile);
        queryClient.setQueryData(["datingProfile", usernameQueryKey], profile);
      } catch {}

      const { socket, isConnected } = get();
      if (!socket || !isConnected) {
        get().connect();
        setTimeout(() => get().broadcastDatingProfileUpdate(profile), 150);
        return;
      }

      let safeProfile: DatingProfile | Record<string, unknown> = profile;
      try {
        safeProfile = JSON.parse(JSON.stringify(profile));
      } catch {}

      try {
        socket.emit("dating:profile:update", {
          username,
          profile: safeProfile,
        });
      } catch {}
    },
  };
});
