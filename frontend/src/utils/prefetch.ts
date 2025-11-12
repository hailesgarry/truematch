import type { QueryClient, QueryKey } from "@tanstack/react-query";

type PrefetchGroupMessagesOptions = {
  force?: boolean;
  requireJoined?: boolean;
  freshMs?: number;
};

let DEFAULT_GROUP_MESSAGE_FRESH_MS = 10_000;

function isQueryFresh(
  state: { dataUpdatedAt: number } | undefined,
  freshMs: number
): boolean {
  if (!state) return false;
  if (!state.dataUpdatedAt) return false;
  return Date.now() - state.dataUpdatedAt < freshMs;
}

// Map of route -> dynamic import function to allow manual preloading
// Fill in for routes that are lazy-loaded
const routePreloaders: Record<string, () => Promise<unknown>> = {
  "/": () => import("../pages/Home"),
  "/dating": () => import("../pages/DatingPage"),
  "/direct": () => import("../pages/DirectMessages"),
  "/matches": () => import("../pages/MatchesPage"),
  "/chat": () => import("../pages/ChatPage"),
  "/chat/": () => import("../pages/ChatPage"),
  "/dm/": () => import("../pages/PrivateChatPage"),
  "/inbox": () => import("../pages/NotificationPage"),
  "/profile/": () => import("../pages/ProfilePage"),
  "/dating-profile/": () => import("../pages/DatingProfilePage"),
  "/dating-profile/create": () => import("../pages/CreateDatingProfile"),
};

export function preloadRoute(path: string): void {
  const match = Object.keys(routePreloaders).find((p) => path.startsWith(p));
  if (match) {
    try {
      void routePreloaders[match]();
    } catch {
      /* ignore */
    }
  }
}

export async function prefetchGroupMessages(
  qc: QueryClient,
  groupId: string,
  options: PrefetchGroupMessagesOptions = {}
): Promise<void> {
  const gid = (groupId || "").trim();
  if (!gid) return;

  const {
    force = false,
    requireJoined = true,
    freshMs = DEFAULT_GROUP_MESSAGE_FRESH_MS,
  } = options;

  try {
    const [messagesModule, socketModule, apiModule] = await Promise.all([
      import("../hooks/useGroupMessagesQuery"),
      import("../stores/socketStore"),
      import("../services/api"),
    ]);

    const {
      messagesKey,
      GROUP_MESSAGES_DEFAULT_WINDOW,
      GROUP_MESSAGES_STALE_TIME_MS,
      GROUP_MESSAGES_GC_TIME_MS,
    } = messagesModule;

    const { fetchLatestGroupMessages } = apiModule;

    DEFAULT_GROUP_MESSAGE_FRESH_MS = GROUP_MESSAGES_STALE_TIME_MS;

    if (requireJoined) {
      try {
        const joinedIds = socketModule.useSocketStore.getState()
          .joinedGroupIds as Set<string> | undefined;
        if (!joinedIds || !joinedIds.has(gid)) {
          return;
        }
      } catch {
        return;
      }
    }

    const queryKey: QueryKey = messagesKey(gid);

    if (!force) {
      const state = qc.getQueryState(queryKey);
      if (isQueryFresh(state, freshMs)) {
        return;
      }
      if (qc.isFetching({ queryKey })) {
        return;
      }
    }

    // Prefetching is temporarily disabled until the new message endpoints are wired up
    await qc.ensureQueryData({
      queryKey,
      queryFn: () =>
        fetchLatestGroupMessages(gid, {
          count: GROUP_MESSAGES_DEFAULT_WINDOW,
        }),
      staleTime: GROUP_MESSAGES_STALE_TIME_MS,
      gcTime: GROUP_MESSAGES_GC_TIME_MS,
    });
  } catch {
    // ignore prefetch errors
  }
}

type PrefetchGroupDetailsOptions = {
  force?: boolean;
  freshMs?: number;
};

// Warm the /groups/:id endpoint so ChatPage has group metadata instantly
export async function prefetchGroupDetails(
  qc: QueryClient,
  groupId: string,
  options: PrefetchGroupDetailsOptions = {}
): Promise<void> {
  const gid = (groupId || "").trim();
  if (!gid) return;

  const { force = false, freshMs = 60_000 } = options;

  try {
    const queryKey: QueryKey = ["group", gid];

    if (!force) {
      const state = qc.getQueryState(queryKey);
      if (isQueryFresh(state, freshMs)) {
        return;
      }
      if (qc.isFetching({ queryKey })) {
        return;
      }
    }

    const { fetchGroupById } = await import("../services/api");
    await qc.ensureQueryData({
      queryKey,
      queryFn: () => fetchGroupById(gid),
      staleTime: 60_000,
      gcTime: 5 * 60_000,
    });
  } catch {
    // ignore prefetch errors
  }
}

// Optionally pair with data prefetch
export async function prefetchData(
  qc: QueryClient,
  path: string
): Promise<void> {
  try {
    if (path === "/") {
      const { groupsKey } = await import("../hooks/useGroupsQuery");
      const { fetchGroups } = await import("../services/api");
      await qc.prefetchQuery({
        queryKey: groupsKey,
        queryFn: () => fetchGroups(false),
      });
    } else if (path.startsWith("/dating")) {
      const { datingProfilesKey } = await import(
        "../hooks/useDatingProfilesQuery"
      );
      const { fetchDatingProfiles } = await import("../services/api");
      await qc.prefetchQuery({
        queryKey: datingProfilesKey,
        queryFn: () => fetchDatingProfiles({ timeoutMs: 7000 }),
        staleTime: 1 * 60_000,
        gcTime: 1 * 60_000,
      });
    }
  } catch {
    // silently ignore prefetch errors
  }
}

// Prefetch DM messages by dmId to make PrivateChatPage instant
export async function prefetchDmMessages(
  qc: QueryClient,
  dmId: string
): Promise<void> {
  const id = (dmId || "").trim();
  if (!id) return;
  try {
    const { dmMessagesKey } = await import("../hooks/useDmMessagesQuery");
    // Messages are maintained via sockets and stored in Zustand; we just seed the cache
    await qc.prefetchQuery({
      queryKey: dmMessagesKey(id),
      queryFn: async () => {
        const { useMessageStore } = await import("../stores/messageStore");
        const list = useMessageStore.getState().messages[id] || [];
        return list;
      },
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    });
  } catch {
    // ignore
  }
}
