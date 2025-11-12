import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useNotificationStore } from "./notificationStore";
import { clearAppStorage } from "../utils/clearStorage";
import { useSocketStore } from "./socketStore";
import { useMessageStore } from "./messageStore";
import { useGroupStore } from "./groupStore";
import { useLikesStore } from "./likesStore";
import { useAvatarStore } from "./avatarStore";
import { useUiStore } from "./uiStore";

// NEW: local monogram generator (data URL) for safe fallback
function generateMonogramAvatar(name: string) {
  const s = (name || "").trim().toUpperCase() || "?";
  const initials =
    s
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("") || "?";
  const hash = Array.from(s).reduce(
    (h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0,
    0
  );
  const colors = [
    "#2563eb",
    "#db2777",
    "#059669",
    "#7c3aed",
    "#ea580c",
    "#0891b2",
    "#16a34a",
    "#9333ea",
  ];
  const bg = colors[Math.abs(hash) % colors.length];
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 128 128'>
    <defs>
      <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
        <stop offset='0%' stop-color='${bg}' />
        <stop offset='100%' stop-color='#111827' stop-opacity='0.12'/>
      </linearGradient>
    </defs>
    <rect width='128' height='128' rx='64' fill='url(#g)' />
    <text x='50%' y='50%' dy='.35em' text-anchor='middle'
      font-family='system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif'
      font-size='56' font-weight='700' fill='white'>${initials}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// NEW: normalize any avatar-like value into a usable URL (or monogram)
function normalizeAvatarUrl(
  value: string | null | undefined,
  username?: string
): string | null {
  if (!value) return null;
  const v = String(value).trim();

  // Already a URL?
  if (/^(data:image\/|https?:\/\/|blob:)/i.test(v)) return v;

  // Raw SVG markup -> data URI
  if (v.startsWith("<svg")) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(v)}`;
  }

  // Heuristic: long base64-like string with valid chars -> base64 data URI
  if (/^[A-Za-z0-9+/=]+$/.test(v) && v.length > 128) {
    return `data:image/svg+xml;base64,${v}`;
  }

  // Anything else: generate a safe monogram
  return generateMonogramAvatar(username || "");
}

import {
  signup as apiSignup,
  login as apiLogin,
  fetchMyProfile,
  registerUnauthorizedHandler,
} from "../services/api";

interface AuthState {
  userId: string | null;
  username: string;
  avatar: string | null;
  token: string | null;
  joined: boolean;
  hydrated: boolean; // becomes true after Zustand persistence rehydrates
  loading: boolean;
  error: string;
  needsMigration?: boolean;
  setUsername: (username: string) => void;
  setAvatar: (avatar: string | null) => void;
  setError: (error: string) => void;
  setHydrated: (v: boolean) => void;
  signup: (
    username: string,
    password: string,
    avatar?: string | null
  ) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  logout: () => void;
}

// If you had earlier persisted shapes, you can describe them loosely:
type PersistedV0OrV1 = Partial<{
  userId: string | null;
  username: string;
  avatar: string | null;
  // 'joined' may not have existed yet
}>;

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      userId: null,
      username: "",
      avatar: null,
      token: null,
      joined: false,
      hydrated: false,
      loading: false,
      error: "",
      needsMigration: false,

      setUsername: (username) => set({ username }),
      // UPDATED: always normalize on set
      setAvatar: (avatar) =>
        set({
          avatar: normalizeAvatarUrl(avatar, get().username),
        }),
      setError: (error) => set({ error }),
      setHydrated: (v: boolean) => set({ hydrated: v }),

      // UPDATED: always normalize what we store
      signup: async (username, password, avatar) => {
        set({ loading: true, error: "" });
        try {
          const resp = await apiSignup(username, password, avatar || null);
          set({
            userId: resp.profile.userId,
            username: resp.profile.username,
            avatar: normalizeAvatarUrl(
              resp.profile.avatarUrl || avatar || null,
              resp.profile.username
            ),
            token: resp.token,
            joined: true,
            loading: false,
            error: "",
            needsMigration: false,
          });
        } catch (e: any) {
          set({
            error: e?.response?.data?.detail || e?.message || "Signup failed",
            loading: false,
          });
        }
      },
      login: async (username, password) => {
        set({ loading: true, error: "" });
        try {
          const resp = await apiLogin(username, password);
          set({
            userId: resp.profile.userId,
            username: resp.profile.username,
            avatar: normalizeAvatarUrl(
              resp.profile.avatarUrl || null,
              resp.profile.username
            ),
            token: resp.token,
            joined: true,
            loading: false,
            error: "",
            needsMigration: false,
          });
        } catch (e: any) {
          set({
            error: e?.response?.data?.detail || e?.message || "Login failed",
            loading: false,
          });
        }
      },
      refreshProfile: async () => {
        const { token } = get();
        if (!token) return;
        try {
          const prof = await fetchMyProfile(token);
          set({
            userId: prof.userId,
            username: prof.username,
            avatar: normalizeAvatarUrl(prof.avatarUrl || null, prof.username),
          });
        } catch (e: any) {
          const status = e?.response?.status || e?.status;
          // If token is invalid/expired, clear auth to avoid repeated 401s
          if (status === 401) {
            set({ token: null, joined: false });
          }
        }
      },

      logout: () => {
        try {
          // 1) Disconnect sockets and reset socket state
          try {
            useSocketStore.getState().disconnect();
          } catch {}

          // 2) Clear in-memory store slices so UI resets immediately
          useNotificationStore.getState().clearAll();
          try {
            useMessageStore.getState().clearAll();
          } catch {}
          try {
            useGroupStore.getState().clearAll();
          } catch {}
          try {
            useLikesStore.getState().clearAll();
          } catch {}
          try {
            useAvatarStore.getState().clearAll();
          } catch {}

          // 3) Reset auth slice immediately in memory
          set({
            userId: null,
            username: "",
            avatar: null,
            token: null,
            joined: false,
            loading: false,
            error: "",
          });

          // 4) Remove all persisted app data from storage
          clearAppStorage("scoped");

          // 5) Also remove the auth persistence entry last to avoid rehydration race
          try {
            localStorage.removeItem("chat-auth");
          } catch {}
        } catch {}
      },
    }),
    {
      name: "chat-auth",
      /**
       * Persist only stable auth identifiers. Avatar is no longer persisted
       * to avoid storing data URLs in localStorage; it will be fetched from
       * the backend profile instead.
       */
      partialize: (s) => ({
        userId: s.userId,
        username: s.username,
        // avatar intentionally excluded from persistence
        token: s.token,
        joined: s.joined,
      }),
      // Bump version to 4: stop persisting avatar, normalize prior values
      version: 4,

      /**
       * Migrate older persisted state objects to the newest shape.
       */
      migrate: (persistedState: any, version: number) => {
        try {
          if (!persistedState || typeof persistedState !== "object") {
            return {
              userId: null,
              username: "",
              avatar: null,
              joined: false,
            };
          }

          // For very old / undefined version treat as 0
          const oldVersion = version ?? 0;

          if (oldVersion <= 1) {
            const s = persistedState as PersistedV0OrV1;
            const username = s.username ?? "";
            return {
              userId: s.userId ?? null,
              username,
              avatar: normalizeAvatarUrl(s.avatar ?? null, username),
              token: (s as any).token || null,
              joined:
                typeof (s as any).joined === "boolean"
                  ? (s as any).joined
                  : Boolean(s.userId),
            } as any;
          }

          // v2 -> v3: normalize avatar if needed
          if (oldVersion === 2) {
            const username = persistedState.username ?? "";
            return {
              userId: persistedState.userId ?? null,
              username,
              avatar: normalizeAvatarUrl(
                persistedState.avatar ?? null,
                username
              ),
              token: (persistedState as any).token || null,
              joined:
                typeof persistedState.joined === "boolean"
                  ? persistedState.joined
                  : Boolean(persistedState.userId),
            } as any;
          }

          // v3 -> v4: drop persisted avatar field
          if (oldVersion === 3) {
            const username = persistedState.username ?? "";
            return {
              userId: persistedState.userId ?? null,
              username,
              // avatar will be fetched from server on rehydrate
              avatar: null,
              token: (persistedState as any).token || null,
              joined:
                typeof persistedState.joined === "boolean"
                  ? persistedState.joined
                  : Boolean(persistedState.userId),
            } as any;
          }

          // Already at v4
          const username = persistedState.username ?? "";
          return {
            userId: persistedState.userId ?? null,
            username,
            // ensure avatar not carried over from older states
            avatar: null,
            token: (persistedState as any).token || null,
            joined:
              typeof persistedState.joined === "boolean"
                ? persistedState.joined
                : Boolean(persistedState.userId),
          } as any;
        } catch {
          // Fallback: start fresh if something unexpected happens
          return {
            userId: null,
            username: "",
            avatar: null,
            token: null,
            joined: false,
          } as any;
        }
      },

      onRehydrateStorage: () => (state, error) => {
        if (error) {
          // console.warn("[authStore] Rehydrate failed", error);
          try {
            state?.setHydrated?.(true);
          } catch {}
          return;
        }
        // Optional: further normalize at runtime if needed
        if (state) {
          try {
            const s = state as unknown as AuthState;
            // Ensure avatar comes from server; clear any legacy persisted value
            if ((s as any).avatar) {
              state.setAvatar?.(null);
            }
            // Determine legacy migration need: user appears joined locally but no token
            if (s.joined && !s.token) {
              (state as any).needsMigration = true;
            }
            // If we have a token, refresh profile to load server avatar
            try {
              (state as any).refreshProfile?.();
            } catch {}
            // Register global 401 handler to auto-logout
            try {
              registerUnauthorizedHandler(() => {
                try {
                  // Show a one-shot toast to inform the user
                  try {
                    useUiStore
                      .getState()
                      .showToast("Session expired. Please log in again.", 2500);
                  } catch {}
                  // Clear token and joined; downstream UI should redirect to login
                  state?.setError?.("");
                  (state as any).logout?.();
                } catch {}
              });
            } catch {}
            // Mark the store as hydrated so route guards can proceed without flicker
            try {
              state.setHydrated?.(true);
            } catch {}
          } catch {
            // ignore
          }
        }
        // console.info("[authStore] Rehydrated", state);
      },
    }
  )
);
