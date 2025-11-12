import React, { useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import PageHeader from "../components/common/PageHeader";
import GroupCard from "../components/common/GroupCard";
import { useGroupsQuery } from "../hooks/useGroupsQuery";
import { useGroupStore } from "../stores/groupStore";
import { useSocketStore } from "../stores/socketStore";
import { useAuthStore } from "../stores/authStore";
import {
  preloadRoute,
  prefetchGroupMessages,
  prefetchGroupDetails,
} from "../utils/prefetch";
import { useNotificationStore } from "../stores/notificationStore";
import type { Group } from "../types";

const collectKeyVariants = (value?: string | null): string[] => {
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];

  const stack: string[] = [trimmed];
  const seen = new Set<string>();
  const variants: string[] = [];

  while (stack.length) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    variants.push(current);

    const lower = current.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      variants.push(lower);
    }

    if (current.includes(":")) {
      for (const part of current.split(":")) {
        const segment = part.trim();
        if (!segment || seen.has(segment)) continue;
        stack.push(segment);
      }
    }
  }

  return variants;
};

const NotificationPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const joined = useAuthStore((state) => state.joined);

  const ensureConnected = useSocketStore((state) => state.ensureConnected);
  const joinedGroupIds = useSocketStore((state) => state.joinedGroupIds);
  const joinGroup = useSocketStore((state) => state.joinGroup);
  const setActiveGroup = useSocketStore((state) => state.setActiveGroup);

  const selectGroup = useGroupStore((state) => state.selectGroup);
  const storeGroups = useGroupStore((state) => state.groups);
  const unreadByGroup = useNotificationStore((state) => state.unreadByGroup);
  const resetGroupUnread = useNotificationStore((state) => state.reset);
  const markGroupNotificationsSeen = useNotificationStore(
    (state) => state.markGroupNotificationsSeen
  );

  const getUnreadCount = useCallback(
    (group: Group): number => {
      if (!group) return 0;

      const candidateKeys = new Set<string>();
      const register = (value?: string | null) => {
        for (const variant of collectKeyVariants(value)) {
          candidateKeys.add(variant);
        }
      };

      register(group.id);
      register(group.databaseId);
      register(group.slug);

      if (!candidateKeys.size) return 0;

      let total = 0;

      for (const [rawKey, rawValue] of Object.entries(unreadByGroup)) {
        if (!rawKey) continue;

        let matches = false;
        for (const variant of collectKeyVariants(rawKey)) {
          if (candidateKeys.has(variant)) {
            matches = true;
            break;
          }
        }

        if (!matches) continue;

        const numeric = Number(rawValue);
        if (!Number.isFinite(numeric) || numeric <= 0) continue;
        total += numeric;
      }

      return total;
    },
    [unreadByGroup]
  );

  const { groupsQuery, groups: queryGroups } = useGroupsQuery({
    enabled: joined,
  });

  useEffect(() => {
    if (joined) {
      ensureConnected();
    }
  }, [joined, ensureConnected]);

  useEffect(() => {
    markGroupNotificationsSeen();
  }, [markGroupNotificationsSeen]);

  const joinedGroups = useMemo(() => {
    if (!joined) return [];

    const candidates: Group[] = [];
    if (Array.isArray(queryGroups)) {
      candidates.push(...queryGroups);
    }
    if (Array.isArray(storeGroups)) {
      candidates.push(...storeGroups);
    }

    if (!candidates.length) return [];

    const seen = new Set<string>();
    const list: Group[] = [];

    for (const group of candidates) {
      if (!group) continue;
      const socketId = (group.id || "").trim();
      const databaseId = (group.databaseId || "").trim();
      const dedupeKey = socketId || databaseId;
      if (!dedupeKey || seen.has(dedupeKey)) {
        continue;
      }
      const isJoined =
        (socketId && joinedGroupIds.has(socketId)) ||
        (databaseId && joinedGroupIds.has(databaseId));
      if (!isJoined) continue;

      seen.add(dedupeKey);
      list.push(group);
    }

    const normalizeTimestamp = (value: unknown) => {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string") {
        const asNumber = Number(value);
        if (Number.isFinite(asNumber)) return asNumber;
      }
      return 0;
    };

    return list.sort((a, b) => {
      const tsFor = (group: Group) => {
        const fromPreview = normalizeTimestamp(
          group.lastMessagePreview?.createdAt
        );
        const fromLastMessage = normalizeTimestamp(group.lastMessageAt);
        const fromActive = normalizeTimestamp(group.lastActiveAt);
        return Math.max(fromPreview, fromLastMessage, fromActive, 0);
      };
      return tsFor(b) - tsFor(a);
    });
  }, [joined, queryGroups, storeGroups, joinedGroupIds]);

  const handleOpenGroup = useCallback(
    (group: Group) => {
      const socketId = (group.id || "").trim();
      if (!socketId) return;

      resetGroupUnread(socketId);
      if (group.databaseId) {
        resetGroupUnread(group.databaseId);
      }

      joinGroup(socketId, group.name);
      setActiveGroup(socketId);
      selectGroup(socketId, group.name);

      const routeId = group.databaseId || socketId;
      navigate(`/chat/${routeId}`, {
        state: {
          from: "/inbox",
          pendingRouteLoading: true,
          loadingMessage: "Opening chat...",
        },
      });
    },
    [joinGroup, setActiveGroup, selectGroup, navigate]
  );

  const handlePrefetch = useCallback(
    (group: Group) => {
      const socketId = (group.id || "").trim();
      if (!socketId) return;

      const routeId = group.databaseId || socketId;
      preloadRoute(`/chat/${routeId}`);
      void prefetchGroupMessages(queryClient, socketId, {
        requireJoined: false,
      });

      const detailIds = new Set<string>();
      if (group.databaseId) detailIds.add(group.databaseId);
      if (socketId) detailIds.add(socketId);
      detailIds.forEach((gid) => {
        void prefetchGroupDetails(queryClient, gid);
      });
    },
    [queryClient]
  );

  const handleBack = useCallback(() => navigate(-1), [navigate]);

  const isLoading = joined && groupsQuery.isLoading;
  const hasError = Boolean(joined && groupsQuery.isError);
  const errorMessage =
    groupsQuery.error instanceof Error
      ? groupsQuery.error.message
      : "Unable to load groups right now.";

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <PageHeader title="Inbox" onBack={handleBack} />
      <div className="mx-auto w-full max-w-xl px-4 pb-10 pt-6">
        {!joined ? (
          <div className="rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
            Join the community to receive room updates here.
          </div>
        ) : hasError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
            {errorMessage}
          </div>
        ) : isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"
              >
                <div className="flex animate-pulse items-center gap-3">
                  <div className="h-12 w-12 rounded-[14px] bg-gray-200" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-2/3 rounded bg-gray-200" />
                    <div className="h-3 w-full rounded bg-gray-100" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : joinedGroups.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
            Rooms you join will appear here so you can jump back into the
            conversation quickly.
          </div>
        ) : (
          <div className="space-y-0">
            {joinedGroups.map((group) => {
              const unreadCount = getUnreadCount(group);

              return (
                <GroupCard
                  key={group.id || group.databaseId || group.name}
                  group={group}
                  onClick={() => handleOpenGroup(group)}
                  unreadCount={unreadCount}
                  hideMembersSection
                  borderless
                  innerPaddingClassName="p-0"
                  onMouseEnter={() => handlePrefetch(group)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default NotificationPage;
