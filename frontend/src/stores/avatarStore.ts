import { create } from "zustand";
import { persist } from "zustand/middleware";

type State = {
  avatars: Record<string, string | null>;
  getAvatar: (username: string | null | undefined) => string | null | undefined;
  setAvatar: (username: string, url: string | null | undefined) => void;
  setFromMessage: (username: string, url?: string | null) => void;
  // No-ops to keep existing callers happy
  ensure: (_username: string | null | undefined) => Promise<void>;
  ensureMany: (_usernames: Array<string | null | undefined>) => Promise<void>;
  clearAll: () => void;
};

export const useAvatarStore = create<State>()(
  persist(
    (set, get) => ({
      avatars: {},
      getAvatar: (username) => {
        if (!username) return undefined;
        return get().avatars[String(username).toLowerCase()] ?? null;
      },
      setAvatar: (username, url) => {
        if (!username) return;
        const key = String(username).toLowerCase();
        set((s) => ({ avatars: { ...s.avatars, [key]: url ?? null } }));
      },
      setFromMessage: (username, url) => {
        if (!username || !url) return;
        const key = String(username).toLowerCase();
        set((s) => ({ avatars: { ...s.avatars, [key]: url } }));
      },
      ensure: async () => {},
      ensureMany: async () => {},
      clearAll: () => set({ avatars: {} }),
    }),
    {
      name: "user-avatars",
      partialize: (s) => ({ avatars: s.avatars }),
      version: 1,
    }
  )
);
