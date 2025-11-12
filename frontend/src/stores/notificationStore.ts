import { create } from "zustand";
import { persist } from "zustand/middleware";

interface NotificationState {
  unreadByGroup: Record<string, number>;
  inc: (groupId: string, by?: number) => void;
  reset: (groupId: string) => void;
  clearAll: () => void;
  hasUnseenGroupNotifications: boolean;
  markGroupNotificationsSeen: () => void;
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, _get) => ({
      unreadByGroup: {},
      hasUnseenGroupNotifications: false,

      inc: (groupId, by = 1) =>
        set((state) => ({
          unreadByGroup: {
            ...state.unreadByGroup,
            [groupId]: (state.unreadByGroup[groupId] || 0) + by,
          },
          hasUnseenGroupNotifications:
            state.hasUnseenGroupNotifications || !groupId.startsWith("dm:"),
        })),

      reset: (groupId) =>
        set((state) => {
          if (!state.unreadByGroup[groupId]) return state;
          const nextUnread = { ...state.unreadByGroup, [groupId]: 0 };
          const hasAnyGroupUnread = Object.entries(nextUnread).some(
            ([key, value]) => !key.startsWith("dm:") && (value || 0) > 0
          );
          return {
            unreadByGroup: nextUnread,
            hasUnseenGroupNotifications: hasAnyGroupUnread
              ? state.hasUnseenGroupNotifications
              : false,
          };
        }),

      clearAll: () =>
        set({ unreadByGroup: {}, hasUnseenGroupNotifications: false }),

      markGroupNotificationsSeen: () =>
        set((state) =>
          state.hasUnseenGroupNotifications
            ? { hasUnseenGroupNotifications: false }
            : state
        ),
    }),
    {
      name: "chat-notifications",
      // Persist counts and unseen flag; totals can be derived on the fly.
      partialize: (s) => ({
        unreadByGroup: s.unreadByGroup,
        hasUnseenGroupNotifications: s.hasUnseenGroupNotifications,
      }),
      version: 2,
      migrate: (persistedState, version) => {
        const safeUnread = (value: unknown): Record<string, number> => {
          if (value && typeof value === "object") {
            return value as Record<string, number>;
          }
          return {};
        };

        if (!persistedState || typeof persistedState !== "object") {
          return {
            unreadByGroup: {},
            hasUnseenGroupNotifications: false,
          };
        }

        const persisted = persistedState as Record<string, unknown>;

        if (version < 2) {
          return {
            unreadByGroup: safeUnread(persisted.unreadByGroup),
            hasUnseenGroupNotifications: false,
          };
        }

        return {
          unreadByGroup: safeUnread(persisted.unreadByGroup),
          hasUnseenGroupNotifications:
            typeof persisted.hasUnseenGroupNotifications === "boolean"
              ? (persisted.hasUnseenGroupNotifications as boolean)
              : false,
        };
      },
    }
  )
);
