import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useNotificationStore } from "./notificationStore";
import { clearAppStorage } from "../utils/clearStorage";
import { useSocketStore } from "./socketStore";
import { useMessageStore } from "./messageStore";
import { useGroupStore } from "./groupStore";
import { useLikesStore } from "./likesStore";
import { useAvatarStore } from "./avatarStore";

// SIMPLE ID GENERATOR (avoid extra deps). Replace with nanoid/uuid if desired.
const genId = () =>
  "u_" +
  Math.random().toString(36).slice(2, 10) +
  Math.random().toString(36).slice(2, 6);

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

interface AuthState {
  userId: string | null;
  username: string;
  avatar: string | null;
  joined: boolean;
  error: string;
  setUsername: (username: string) => void;
  setAvatar: (avatar: string | null) => void;
  setError: (error: string) => void;
  login: (username: string, avatar: string | null) => void;
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
      joined: false,
      error: "",

      setUsername: (username) => set({ username }),
      // UPDATED: always normalize on set
      setAvatar: (avatar) =>
        set({
          avatar: normalizeAvatarUrl(avatar, get().username),
        }),
      setError: (error) => set({ error }),

      // UPDATED: always normalize what we store
      login: (username, avatar) => {
        if (!username.trim()) {
          set({ error: "Username is required" });
          return;
        }
        let { userId } = get();
        if (!userId) userId = genId();
        set({
          userId,
          username,
          avatar: normalizeAvatarUrl(avatar, username),
          joined: true,
          error: "",
        });
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
            joined: false,
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
       * Only persist these keys; ephemeral 'error' is excluded.
       */
      partialize: (s) => ({
        userId: s.userId,
        username: s.username,
        avatar: s.avatar,
        joined: s.joined,
      }),
      // UPDATED: bump version to 3 to normalize existing values
      version: 3,

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
              // Normalize whatever is there (may be raw SVG/string)
              avatar: normalizeAvatarUrl(s.avatar ?? null, username),
              // 'joined' was derived: if a userId existed, consider them joined
              joined:
                typeof (s as any).joined === "boolean"
                  ? (s as any).joined
                  : Boolean(s.userId),
            };
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
              joined:
                typeof persistedState.joined === "boolean"
                  ? persistedState.joined
                  : Boolean(persistedState.userId),
            };
          }

          // Already at v3
          const username = persistedState.username ?? "";
          return {
            userId: persistedState.userId ?? null,
            username,
            avatar: normalizeAvatarUrl(persistedState.avatar ?? null, username),
            joined:
              typeof persistedState.joined === "boolean"
                ? persistedState.joined
                : Boolean(persistedState.userId),
          };
        } catch {
          // Fallback: start fresh if something unexpected happens
          return {
            userId: null,
            username: "",
            avatar: null,
            joined: false,
          };
        }
      },

      onRehydrateStorage: () => (state, error) => {
        if (error) {
          // console.warn("[authStore] Rehydrate failed", error);
          return;
        }
        // Optional: further normalize at runtime if needed
        if (state) {
          try {
            const s = state as unknown as AuthState;
            if (
              s.avatar &&
              !/^(data:image\/|https?:\/\/|blob:)/i.test(s.avatar)
            ) {
              state.setAvatar?.(normalizeAvatarUrl(s.avatar, s.username));
            }
          } catch {
            // ignore
          }
        }
        // console.info("[authStore] Rehydrated", state);
      },
    }
  )
);
