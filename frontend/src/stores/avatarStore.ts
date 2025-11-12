import { create } from "zustand";
import { persist } from "zustand/middleware";
import { fetchProfileByUsername } from "../services/api";

type State = {
  avatars: Record<string, string | null>;
  // Ephemeral caches (not persisted)
  _lastFetched: Record<string, number>;
  _inFlight: Record<string, Promise<void> | undefined>;
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
      // ephemeral caches (not persisted)
      _lastFetched: {} as Record<string, number>,
      _inFlight: {} as Record<string, Promise<void>>,
      getAvatar: (username: string | null | undefined) => {
        if (!username) return undefined;
        return get().avatars[String(username).toLowerCase()] ?? null;
      },
      setAvatar: (username: string, url: string | null | undefined) => {
        if (!username) return;
        const key = String(username).toLowerCase();
        // Do not overwrite a known non-null avatar with null/undefined.
        set((s) => {
          const current = s.avatars[key] ?? null;
          if (url == null) {
            // If we don't have any value yet, keep null to allow ensure() to fetch.
            return { avatars: { ...s.avatars, [key]: current ?? null } } as any;
          }
          // Accept the provided URL (cloudinary/http/data URL)
          return { avatars: { ...s.avatars, [key]: url } } as any;
        });
      },
      setFromMessage: (username: string, url?: string | null) => {
        if (!username || !url) return;
        const key = String(username).toLowerCase();
        set((s) => ({ avatars: { ...s.avatars, [key]: url } }));
      },
      ensure: async (username: string | null | undefined) => {
        const u = (username || "").trim();
        if (!u) return;
        const key = u.toLowerCase();
        const state = get();
        // If we already have a non-null URL, skip
        const existing = state.avatars[key];
        const now = Date.now();
        const TTL = 5 * 60 * 1000; // 5 minutes
        if (existing) return;
        // Rate-limit network fetches
        const last = state._lastFetched?.[key] || 0;
        if (now - last < TTL) return;
        // De-dupe concurrent fetches
        if (state._inFlight?.[key]) {
          try {
            await state._inFlight[key];
          } catch {}
          return;
        }
        const p: Promise<void> = (async () => {
          try {
            const prof = await fetchProfileByUsername(u);
            const url = prof?.avatarUrl || null;
            if (url != null) {
              set((s) => ({ avatars: { ...s.avatars, [key]: url } }));
            } else {
              // Only cache null if we don't already have a non-null value
              set((s) => {
                const cur = s.avatars[key] ?? null;
                if (cur) return s as any;
                return { avatars: { ...s.avatars, [key]: null } } as any;
              });
            }
          } catch {
            // ignore
          } finally {
            // mark fetched time and clear inFlight using set()
            set((s) => {
              const lf = { ...s._lastFetched, [key]: Date.now() };
              const inflight = { ...s._inFlight };
              delete inflight[key];
              return {
                _lastFetched: lf,
                _inFlight: inflight,
              } as Partial<State> as any;
            });
          }
        })();
        // track in-flight
        set((s) => ({ _inFlight: { ...s._inFlight, [key]: p } }));
        await p;
      },
      ensureMany: async (usernames: Array<string | null | undefined>) => {
        const unique = Array.from(
          new Set(
            (usernames || [])
              .map((u) => (u || "").trim())
              .filter(Boolean)
              .map((u) => u.toLowerCase())
          )
        );
        // Fire requests in small parallel batches to avoid thundering herd
        const BATCH = 5;
        for (let i = 0; i < unique.length; i += BATCH) {
          const slice = unique.slice(i, i + BATCH);
          await Promise.all(slice.map((u) => get().ensure(u)));
        }
      },
      clearAll: () => set({ avatars: {}, _lastFetched: {}, _inFlight: {} }),
    }),
    {
      name: "user-avatars",
      // Only persist avatars; ephemeral maps are excluded on purpose
      partialize: (s: State) => ({ avatars: s.avatars }),
      version: 1,
    }
  )
);
