import { create } from "zustand";
import { persist } from "zustand/middleware";

interface NotificationState {
  unreadByGroup: Record<string, number>;
  inc: (groupId: string, by?: number) => void;
  reset: (groupId: string) => void;
  clearAll: () => void;
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      unreadByGroup: {},

      inc: (groupId, by = 1) =>
        set((state) => ({
          unreadByGroup: {
            ...state.unreadByGroup,
            [groupId]: (state.unreadByGroup[groupId] || 0) + by,
          },
        })),

      reset: (groupId) =>
        set((state) => {
          if (!state.unreadByGroup[groupId]) return state;
          return {
            unreadByGroup: { ...state.unreadByGroup, [groupId]: 0 },
          };
        }),

      clearAll: () => set({ unreadByGroup: {} }),
    }),
    {
      name: "chat-notifications",
      // Only persist the counts map; totals can be derived on the fly.
      partialize: (s) => ({ unreadByGroup: s.unreadByGroup }),
      version: 1,
    }
  )
);
