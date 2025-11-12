import { create } from "zustand";
import { persist } from "zustand/middleware";

interface DmThreadState {
  // Map of dmId -> hiddenAt timestamp (ms since epoch)
  hidden: Record<string, number>;
  hide: (dmId: string, at?: number) => void;
  unhide: (dmId: string) => void;
  isHidden: (dmId: string) => boolean;
  getHiddenAt: (dmId: string) => number | undefined;
  clearAll: () => void;
}

export const useDmThreadStore = create<DmThreadState>()(
  persist(
    (set, get) => ({
      hidden: {},

      hide: (dmId, at) =>
        set((state) => ({
          hidden: { ...state.hidden, [dmId]: at ?? Date.now() },
        })),

      unhide: (dmId) =>
        set((state) => {
          if (!state.hidden[dmId]) return state;
          const next = { ...state.hidden } as Record<string, number>;
          delete next[dmId];
          return { hidden: next } as any;
        }),

      isHidden: (dmId) => get().hidden[dmId] != null,

      getHiddenAt: (dmId) => get().hidden[dmId],

      clearAll: () => set({ hidden: {} }),
    }),
    {
      name: "dm-hidden-threads",
      partialize: (s) => ({ hidden: s.hidden }),
      version: 2,
      migrate: (persisted: any, fromVersion: number) => {
        if (!persisted) return { hidden: {} };
        if (fromVersion < 2) {
          const prev = persisted.hidden || {};
          // Convert boolean map -> timestamp map (use 0 so any new msg will unhide)
          const next: Record<string, number> = {};
          for (const [k, v] of Object.entries(prev)) {
            if (v) next[k] = 0;
          }
          return { hidden: next };
        }
        return persisted;
      },
    }
  )
);
