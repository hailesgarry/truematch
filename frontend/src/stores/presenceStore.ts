import { create } from "zustand";

interface PresenceState {
  online: Set<string>; // lowercased usernames
  lastActive: Map<string, number>; // lowercased username -> epoch ms
  setSnapshot: (users: string[], lastActive?: Record<string, number>) => void;
  touch: (username: string, at?: number) => void;
  setOnline: (username: string, at?: number) => void;
  setOffline: (username: string, at?: number) => void;
  rename: (from: string, to: string) => void;
  isOnline: (username?: string | null) => boolean;
  getLastActive: (username?: string | null) => number | null;
}

export const usePresenceStore = create<PresenceState>((set, get) => ({
  online: new Set<string>(),
  lastActive: new Map<string, number>(),

  setSnapshot: (users, last) =>
    set(() => ({
      online: new Set((users || []).map((u) => u.toLowerCase())),
      lastActive: new Map(
        Object.entries(last || {}).map(([k, v]) => [k.toLowerCase(), Number(v)])
      ),
    })),

  touch: (username, at) =>
    set((state) => {
      if (!username) return state;
      const u = username.toLowerCase();
      const la = new Map(state.lastActive);
      la.set(u, at ?? Date.now());
      return { lastActive: la };
    }),

  setOnline: (username, at) =>
    set((state) => {
      if (!username) return state;
      const next = new Set(state.online);
      const u = username.toLowerCase();
      next.add(u);
      const la = new Map(state.lastActive);
      la.set(u, at ?? Date.now());
      return { online: next, lastActive: la };
    }),

  setOffline: (username, at) =>
    set((state) => {
      if (!username) return state;
      const next = new Set(state.online);
      const u = username.toLowerCase();
      next.delete(u);
      const la = new Map(state.lastActive);
      la.set(u, at ?? Date.now()); // record when we saw them last
      return { online: next, lastActive: la };
    }),

  rename: (from, to) =>
    set((state) => {
      const next = new Set(state.online);
      const la = new Map(state.lastActive);
      if (from) {
        next.delete(from.toLowerCase());
        const last = la.get(from.toLowerCase());
        if (last) la.delete(from.toLowerCase());
      }
      if (to) {
        next.add(to.toLowerCase());
        // keep lastActive if we had one
        const prev = state.lastActive.get(from?.toLowerCase?.() || "");
        if (prev) la.set(to.toLowerCase(), prev);
      }
      return { online: next, lastActive: la };
    }),

  isOnline: (username) => {
    if (!username) return false;
    return get().online.has(String(username).toLowerCase());
  },

  getLastActive: (username) => {
    if (!username) return null;
    const u = String(username).toLowerCase();
    return get().lastActive.get(u) ?? null;
  },
}));
