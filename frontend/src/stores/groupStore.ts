import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Group, User } from "../types";

interface GroupState {
  groups: Group[];
  currentGroup: Group | null;
  onlineUsers: User[];
  isLoading: boolean;
  error: string | null;
  setGroups: (groups: Group[]) => void;
  setCurrentGroup: (group: Group | null) => void;
  setOnlineUsers: (users: User[]) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  selectGroup: (groupId: string, groupName: string) => void;
  clearCurrentGroup: () => void;
  mergeOnlineCounts: (counts: Record<string, number>) => void;
  clearAll: () => void;
}

export const useGroupStore = create<GroupState>()(
  persist(
    (set, get) => ({
      groups: [],
      currentGroup: null,
      onlineUsers: [],
      isLoading: false,
      error: null,
      setGroups: (groups) => set({ groups }),
      setCurrentGroup: (group) => set({ currentGroup: group }),
      setOnlineUsers: (users) => set({ onlineUsers: users }),
      setLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
      selectGroup: (groupId, groupName) => {
        const existing = get().groups.find(
          (g) => g.id === groupId || g.databaseId === groupId
        );
        if (existing) {
          set({ currentGroup: existing });
        } else {
          const inferredSlug = groupId;
          set({
            currentGroup: {
              id: inferredSlug,
              databaseId: groupId,
              name: groupName,
              description: `Welcome to ${groupName}!`,
            },
          });
        }
      },
      clearCurrentGroup: () => set({ currentGroup: null }),
      mergeOnlineCounts: (counts) => {
        set((state) => ({
          groups: state.groups.map((g) => ({
            ...g,
            onlineCount: counts[g.id] || 0,
          })),
          currentGroup: state.currentGroup
            ? {
                ...state.currentGroup,
                onlineCount:
                  counts[state.currentGroup.id] ||
                  state.currentGroup.onlineCount,
              }
            : null,
        }));
      },
      clearAll: () => set({ groups: [], currentGroup: null, onlineUsers: [] }),
    }),
    {
      name: "chat-groups",
      // Persist the entire groups list and the selected/current group
      partialize: (s) => ({ groups: s.groups, currentGroup: s.currentGroup }),
      version: 2,
      migrate: (persisted: any, fromVersion: number) => {
        if (!persisted) return { groups: [], currentGroup: null } as any;
        if (fromVersion < 2) {
          return {
            groups: Array.isArray((persisted as any).groups)
              ? (persisted as any).groups
              : [],
            currentGroup: (persisted as any).currentGroup || null,
          } as any;
        }
        return persisted as any;
      },
    }
  )
);
