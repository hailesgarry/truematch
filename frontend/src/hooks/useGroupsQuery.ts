import { useEffect, useRef } from "react";
import {
  useQuery,
  useQueryClient,
  useMutation,
  focusManager,
} from "@tanstack/react-query";
import {
  fetchGroups,
  createGroup,
  updateGroup,
  deleteGroup,
} from "../services/api";
import type { Group } from "../types";
import { useGroupStore } from "../stores/groupStore";
import { useBroadcastChannel } from "./useBroadcastChannel";
import { broadcastMessage } from "../lib/broadcast";

// Query keys (kept centralized for consistency)
export const groupsKey = ["groups", "list"];
/**
 * useGroupsQuery
 *
 * Industry-standard data layer using TanStack Query for:
 *  - Caching & stale-times (prevents hammering backend)
 *  - Automatic retries on transient network timeouts (axios interceptor already adds small retries)
 *  - Background refetch with window focus / reconnect events
 *  - Cancellation on component unmount (avoids leaked promises mistaken as ECONNABORTED)
 */
export function useGroupsQuery(options?: { enabled?: boolean }) {
  const { setGroups } = useGroupStore();
  const qc = useQueryClient();

  useEffect(() => {
    if (typeof window === "undefined") return;

    let hiddenTimer: ReturnType<typeof setTimeout> | null = null;

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        if (hiddenTimer !== null) {
          clearTimeout(hiddenTimer);
          hiddenTimer = null;
        }
        focusManager.setFocused(true);
        return;
      }

      if (hiddenTimer !== null) {
        clearTimeout(hiddenTimer);
      }
      hiddenTimer = setTimeout(() => {
        focusManager.setFocused(false);
      }, 60_000);
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (hiddenTimer !== null) {
        clearTimeout(hiddenTimer);
      }
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const groupsQuery = useQuery<Group[], Error>({
    queryKey: groupsKey,
    queryFn: () => fetchGroups(false),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: 180_000,
    refetchIntervalInBackground: true,
    retry: 2,
    enabled: options?.enabled ?? true,
  });

  // Sync query results into Zustand for backwards compatibility
  useEffect(() => {
    if (groupsQuery.data) setGroups(groupsQuery.data);
  }, [groupsQuery.data, setGroups]);

  const lastGroupsBroadcastRef = useRef(0);

  useEffect(() => {
    if (!groupsQuery.isSuccess || groupsQuery.isFetching) {
      return;
    }
    const updatedAt = groupsQuery.dataUpdatedAt || Date.now();
    if (updatedAt <= lastGroupsBroadcastRef.current) {
      return;
    }
    lastGroupsBroadcastRef.current = updatedAt;
    broadcastMessage("tm:groups", { type: "groups:refetched" });
  }, [
    groupsQuery.isSuccess,
    groupsQuery.isFetching,
    groupsQuery.dataUpdatedAt,
  ]);

  useBroadcastChannel<
    { type: "groups:refetched" } | { type: "groups:invalidate" }
  >("tm:groups", (payload) => {
    if (payload.type === "groups:refetched") {
      qc.invalidateQueries({ queryKey: groupsKey, exact: true });
      return;
    }
    if (payload.type === "groups:invalidate") {
      qc.invalidateQueries({ queryKey: groupsKey });
      return;
    }
  });

  return {
    groupsQuery,
    groups: groupsQuery.data || [],
    onlineCounts: {},
    // Mutations with automatic cache invalidation
    createGroupMutation: useMutation({
      mutationFn: createGroup,
      onMutate: async (newGroup) => {
        // Cancel any outgoing refetches
        await qc.cancelQueries({ queryKey: groupsKey });
        // Snapshot the previous value
        const previousGroups = qc.getQueryData<Group[]>(groupsKey);
        // Optimistically update to the new value
        const optimisticGroup: Group = {
          id: newGroup.id || `temp-${Date.now()}`,
          name: newGroup.name,
          description: newGroup.description || "",
          avatarUrl: newGroup.avatarUrl,
          databaseId: newGroup.id || `temp-${Date.now()}`,
          onlineCount: 0,
        };
        qc.setQueryData<Group[]>(groupsKey, (old) =>
          old ? [...old, optimisticGroup] : [optimisticGroup]
        );
        // Return a context object with the snapshotted value
        return { previousGroups };
      },
      onError: (_err, _newGroup, context) => {
        // If the mutation fails, use the context returned from onMutate to roll back
        if (context?.previousGroups) {
          qc.setQueryData(groupsKey, context.previousGroups);
        }
      },
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: groupsKey });
        broadcastMessage("tm:groups", { type: "groups:invalidate" });
      },
    }),
    updateGroupMutation: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: Partial<Group> }) =>
        updateGroup(id, patch),
      onMutate: async ({ id, patch }) => {
        // Cancel any outgoing refetches
        await qc.cancelQueries({ queryKey: groupsKey });
        // Snapshot the previous value
        const previousGroups = qc.getQueryData<Group[]>(groupsKey);
        // Optimistically update the group
        qc.setQueryData<Group[]>(groupsKey, (old) =>
          old ? old.map((g) => (g.id === id ? { ...g, ...patch } : g)) : old
        );
        // Return a context object with the snapshotted value
        return { previousGroups };
      },
      onError: (_err, _variables, context) => {
        // If the mutation fails, use the context returned from onMutate to roll back
        if (context?.previousGroups) {
          qc.setQueryData(groupsKey, context.previousGroups);
        }
      },
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: groupsKey });
        broadcastMessage("tm:groups", { type: "groups:invalidate" });
      },
    }),
    deleteGroupMutation: useMutation({
      mutationFn: (groupId: string) => deleteGroup(groupId),
      onMutate: async (groupId) => {
        // Cancel any outgoing refetches
        await qc.cancelQueries({ queryKey: groupsKey });
        // Snapshot the previous value
        const previousGroups = qc.getQueryData<Group[]>(groupsKey);
        // Optimistically remove the group
        qc.setQueryData<Group[]>(groupsKey, (old) =>
          old ? old.filter((g) => g.id !== groupId) : old
        );
        // Return a context object with the snapshotted value
        return { previousGroups };
      },
      onError: (_err, _groupId, context) => {
        // If the mutation fails, use the context returned from onMutate to roll back
        if (context?.previousGroups) {
          qc.setQueryData(groupsKey, context.previousGroups);
        }
      },
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: groupsKey });
        broadcastMessage("tm:groups", { type: "groups:invalidate" });
      },
    }),
  };
}
