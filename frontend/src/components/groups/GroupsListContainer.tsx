import React, { useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Group } from "../../types";
import { fetchGroupsFromApi } from "../../services/api";
import { useAuthStore } from "../../stores/authStore";
import { useGroupStore } from "../../stores/groupStore";
import { useSocketStore } from "../../stores/socketStore";
import {
  prefetchGroupMessages,
  preloadRoute,
  prefetchGroupDetails,
} from "../../utils/prefetch";
import GroupsList from "./GroupsList.tsx";
import GroupCardSkeleton from "../common/GroupCardSkeleton";
import {
  GROUP_MESSAGES_STALE_TIME_MS,
  messagesKey,
} from "../../hooks/useGroupMessagesQuery";
import { isQueryFresh } from "../../lib/queryDiagnostics";
import { useMessageStore } from "../../stores/messageStore";
import { useUiStore } from "../../stores/uiStore";

const groupListKey = ["home", "groups"] as const;

const GroupsListContainer: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const joined = useAuthStore((state) => state.joined);
  const setGroups = useGroupStore((state) => state.setGroups);
  const selectGroup = useGroupStore((state) => state.selectGroup);
  const currentGroup = useGroupStore((state) => state.currentGroup);

  const ensureConnected = useSocketStore((state) => state.ensureConnected);
  const joinGroup = useSocketStore((state) => state.joinGroup);
  const setActiveGroup = useSocketStore((state) => state.setActiveGroup);
  const joinedGroupIds = useSocketStore((state) => state.joinedGroupIds);

  const { data, isLoading, isError, error } = useQuery<Group[]>({
    queryKey: groupListKey,
    queryFn: fetchGroupsFromApi,
    enabled: joined,
    staleTime: 60_000,
  });

  const groups = React.useMemo(() => data ?? [], [data]);
  const prefetchedGroupIdsRef = React.useRef<Set<string>>(new Set());

  const maybeStartRouteProgress = React.useCallback((group: Group) => {
    const ids = new Set<string>();
    const add = (value?: string | null) => {
      if (!value) return;
      const trimmed = value.trim();
      if (trimmed) ids.add(trimmed);
    };

    add(group.databaseId);
    add(group.id);

    if (ids.size === 0) {
      return;
    }

    const messageState = useMessageStore.getState().messages;
    let warm = false;

    for (const candidate of ids) {
      if (
        isQueryFresh(messagesKey(candidate), {
          staleTime: GROUP_MESSAGES_STALE_TIME_MS,
        })
      ) {
        warm = true;
        break;
      }

      const cached = messageState[candidate];
      if (Array.isArray(cached) && cached.length > 0) {
        warm = true;
        break;
      }
    }

    if (!warm) {
      for (const candidate of ids) {
        if (
          isQueryFresh(["group", candidate], {
            staleTime: 60_000,
          })
        ) {
          warm = true;
          break;
        }
      }
    }

    if (!warm) {
      const uiState = useUiStore.getState();
      if (!uiState.routeLoading) {
        uiState.startRouteLoading("Loading chat…");
      }
    }
  }, []);

  useEffect(() => {
    if (joined) {
      ensureConnected();
    }
  }, [joined, ensureConnected]);

  useEffect(() => {
    setGroups(groups);
  }, [groups, setGroups]);

  useEffect(() => {
    if (!joined) {
      return;
    }

    const candidates: string[] = [];
    const addCandidate = (value?: string | null) => {
      if (!value) return;
      candidates.push(value);
    };

    addCandidate(currentGroup?.id);
    addCandidate(currentGroup?.databaseId);

    if (groups.length) {
      for (const group of groups) {
        addCandidate(group.id);
        addCandidate(group.databaseId);
        if (candidates.length >= 12) {
          break;
        }
      }
    }

    const alreadyPrefetched = prefetchedGroupIdsRef.current;
    const uniqueToPrefetch: string[] = [];

    for (const raw of candidates) {
      const trimmed = raw.trim();
      if (!trimmed || alreadyPrefetched.has(trimmed)) {
        continue;
      }
      alreadyPrefetched.add(trimmed);
      uniqueToPrefetch.push(trimmed);
      if (uniqueToPrefetch.length >= 6) {
        break;
      }
    }

    if (uniqueToPrefetch.length === 0) {
      return;
    }

    for (const gid of uniqueToPrefetch) {
      void prefetchGroupDetails(queryClient, gid);
    }
  }, [joined, groups, currentGroup?.id, currentGroup?.databaseId, queryClient]);

  const handleSelectGroup = useCallback(
    (group: Group) => {
      const targetId = group.id;
      const routeRoomId = group.databaseId || targetId;
      if (!routeRoomId) return;

      maybeStartRouteProgress(group);

      joinGroup(routeRoomId, group.name);
      setActiveGroup(routeRoomId);
      selectGroup(targetId, group.name);

      void prefetchGroupMessages(queryClient, routeRoomId, {
        requireJoined: false,
      });

      const detailIds = new Set<string>();
      if (group.databaseId) detailIds.add(group.databaseId);
      if (group.id) detailIds.add(group.id);
      detailIds.forEach((gid) => {
        const trimmed = gid.trim();
        if (!trimmed) return;
        if (!prefetchedGroupIdsRef.current.has(trimmed)) {
          prefetchedGroupIdsRef.current.add(trimmed);
        }
        void prefetchGroupDetails(queryClient, trimmed);
      });

      navigate(`/chat/${routeRoomId}`, { state: { from: "/" } });
    },
    [
      joinGroup,
      setActiveGroup,
      selectGroup,
      queryClient,
      navigate,
      maybeStartRouteProgress,
    ]
  );

  const handlePrefetch = useCallback(
    (group: Group) => {
      const routeRoomId = group.databaseId || group.id;
      preloadRoute(`/chat/${routeRoomId}`);
      void prefetchGroupMessages(queryClient, group.id);
      const detailIds = new Set<string>();
      if (group.databaseId) detailIds.add(group.databaseId);
      if (group.id) detailIds.add(group.id);
      detailIds.forEach((gid) => {
        const trimmed = gid.trim();
        if (!trimmed) return;
        if (!prefetchedGroupIdsRef.current.has(trimmed)) {
          prefetchedGroupIdsRef.current.add(trimmed);
        }
        void prefetchGroupDetails(queryClient, trimmed);
      });
    },
    [queryClient]
  );

  if (!joined) {
    return (
      <div className="p-4 text-sm text-gray-500">
        Join the community to view available groups.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="px-4 py-4">
        {[0, 1, 2].map((index) => (
          <GroupCardSkeleton key={index} borderless />
        ))}
      </div>
    );
  }

  if (isError) {
    const message =
      error instanceof Error ? error.message : "Unable to load groups.";
    return (
      <div className="p-4 text-sm text-red-600">
        Failed to fetch groups: {message}
      </div>
    );
  }

  return (
    <GroupsList
      groups={groups}
      joinedGroupIds={joinedGroupIds}
      onSelectGroup={handleSelectGroup}
      onPrefetchGroup={handlePrefetch}
      onPressGroup={maybeStartRouteProgress}
    />
  );
};

export default GroupsListContainer;
