import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { useLikesStore } from "../stores/likesStore";
import { useQuery } from "@tanstack/react-query";
import {
  fetchDatingProfile,
  fetchLikesReceived,
  fetchMatches,
  fetchProfilesByUserIds,
  fetchProfilesByUsernames,
} from "../services/api";
import type { LikeSummary } from "../services/api";
import { useDatingStore } from "../stores/datingStore";
import LikeCard from "../components/common/LikeCard";
import MatchesCard from "../components/common/MatchesCard";
import type { DatingProfile } from "../types";
import LoadingSpinner from "../components/ui/LoadingSpinner";
import ScrollRestoration, {
  type ScrollRestorationHandle,
} from "../components/common/ScrollRestoration";
import PageHeader from "../components/common/PageHeader";
import type { DatingLikeProfile } from "../stores/likesStore";

const INBOX_TAB_STORAGE_KEY = "__inbox:activeTab";
const INBOX_SCROLL_STORAGE_KEY_PREFIX = "__inbox:scroll:";
const MATCHES_TAB_KEY = "matches" as const;
const LIKES_TAB_KEY = "likes" as const;

type LikeListEntry = {
  key: string;
  userId: string | null;
  username: string;
  at: number;
  matchedAt: number | null;
  profileHint: DatingLikeProfile | null;
  displayName?: string | null;
  avatar?: string | null;
};

const normalizeIdentifier = (value?: string | null): string => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed;
};

const normalizeUsernameKey = (value?: string | null): string => {
  const trimmed = normalizeIdentifier(value);
  return trimmed.toLowerCase();
};

const deriveEntryKey = (
  userId?: string | null,
  username?: string | null
): string => {
  const normalizedId = normalizeIdentifier(userId);
  if (normalizedId) return `id:${normalizedId}`;
  const normalizedUsername = normalizeUsernameKey(username);
  return normalizedUsername ? `name:${normalizedUsername}` : "";
};

const profileFromHint = (
  hint: DatingLikeProfile | null | undefined,
  fallbackUsername: string
): DatingProfile => {
  const safeUsername = (hint?.username || fallbackUsername || "").trim();
  const username = safeUsername || fallbackUsername;

  const gallery = Array.isArray(hint?.photos)
    ? hint!.photos
        .map((src) => (typeof src === "string" ? src.trim() : ""))
        .filter((src) => src.length > 0)
    : [];
  const photoUrlValue =
    typeof hint?.photoUrl === "string" ? hint.photoUrl.trim() : "";
  const photos = Array.from(
    new Set([photoUrlValue, ...gallery].filter((src) => src && src.length > 0))
  );

  const profile: DatingProfile = {
    username,
  };

  if (hint) {
    if (hint.firstName !== undefined) {
      profile.firstName = hint.firstName ?? undefined;
    }
    if (hint.displayName !== undefined) {
      profile.displayName = hint.displayName ?? undefined;
    }
    if (typeof hint.age === "number" && Number.isFinite(hint.age)) {
      profile.age = hint.age;
    }
    if (hint.gender !== undefined) {
      profile.gender = hint.gender;
    }
    if (hint.mood !== undefined) {
      profile.mood = hint.mood;
    }
    const loc = hint.location;
    if (loc) {
      profile.location = {
        city: loc.city,
        state: loc.state,
        formatted: loc.formatted,
      };
    }
  }

  if (photos.length) {
    profile.photos = photos;
    profile.photoUrl = photos[0];
  } else if (photoUrlValue) {
    profile.photoUrl = photoUrlValue;
  }

  return profile;
};

const resolveProfileForEntry = (
  entry: LikeListEntry,
  profileMap: Map<string, DatingProfile>
): DatingProfile => {
  const fetched = profileMap.get(entry.key);
  if (fetched) return fetched;
  if (entry.username) {
    const fallbackKey = deriveEntryKey(null, entry.username);
    const fallback = fallbackKey ? profileMap.get(fallbackKey) : undefined;
    if (fallback) return fallback;
  }
  if (entry.profileHint) {
    return profileFromHint(entry.profileHint, entry.username);
  }
  const fallback: DatingProfile = { username: entry.username };
  if (entry.displayName) {
    fallback.displayName = entry.displayName;
    if (!fallback.firstName) fallback.firstName = entry.displayName;
  }
  if (entry.avatar) {
    fallback.photoUrl = entry.avatar;
    fallback.photos = [entry.avatar];
  }
  return fallback;
};

const MatchesPage: React.FC = () => {
  const navigate = useNavigate();

  const readStoredTab = (): typeof MATCHES_TAB_KEY | typeof LIKES_TAB_KEY => {
    if (typeof window === "undefined") return MATCHES_TAB_KEY;
    try {
      const stored = sessionStorage.getItem(INBOX_TAB_STORAGE_KEY);
      if (stored === MATCHES_TAB_KEY || stored === LIKES_TAB_KEY) {
        return stored;
      }
      if (stored === "general") return MATCHES_TAB_KEY;
    } catch {
      /* ignore */
    }
    return MATCHES_TAB_KEY;
  };

  // Tab state
  const [tab, setTabState] = useState<
    typeof MATCHES_TAB_KEY | typeof LIKES_TAB_KEY
  >(readStoredTab());
  const scrollRestorationRef = useRef<ScrollRestorationHandle | null>(null);

  const changeTab = useCallback(
    (next: typeof MATCHES_TAB_KEY | typeof LIKES_TAB_KEY) => {
      if (tab === next) return;
      scrollRestorationRef.current?.save();
      setTabState(next);
    },
    [tab]
  );

  // Extracted tabs row (static; no sticky/scroll logic)
  // Derive whether I have a profile; if not, hide likes tabs content
  const { userId, joined, token } = useAuthStore();
  const { data: meProfile } = useQuery({
    queryKey: ["datingProfile", userId ?? ""],
    queryFn: () => fetchDatingProfile({ userId }),
    enabled: !!userId,
  });
  const localProfile = useDatingStore((s) => s.profile);
  const hasMyProfile = useMemo(() => {
    if (meProfile !== undefined) {
      if (meProfile === null) return false;
      const p: any = meProfile;
      return Boolean(
        (Array.isArray(p?.photos) && p.photos.length > 0) ||
          p?.photoUrl ||
          p?.photo ||
          p?.mood ||
          typeof p?.age === "number" ||
          p?.gender ||
          p?.religion
      );
    }
    return Boolean(localProfile?.photo || (localProfile as any)?.mood);
  }, [meProfile, localProfile]);

  const authToken = useMemo(
    () => (typeof token === "string" ? token.trim() : ""),
    [token]
  );
  const likesQueriesEnabled = hasMyProfile && authToken.length > 0;

  const likesReceivedQuery = useQuery({
    queryKey: ["datingLikes", "incoming", userId ?? ""],
    queryFn: () => {
      if (!authToken) throw new Error("auth token required");
      return fetchLikesReceived(authToken);
    },
    enabled: likesQueriesEnabled,
    staleTime: 20_000,
  });

  const matchesQuery = useQuery({
    queryKey: ["datingLikes", "matches", userId ?? ""],
    queryFn: () => {
      if (!authToken) throw new Error("auth token required");
      return fetchMatches(authToken);
    },
    enabled: likesQueriesEnabled,
    staleTime: 20_000,
  });

  useEffect(() => {
    if (!likesQueriesEnabled || !likesReceivedQuery.isSuccess) return;
    const summaries: LikeSummary[] = likesReceivedQuery.data ?? [];
    const items = summaries.map((summary) => ({
      userId: summary.userId,
      username: summary.username ?? summary.userId,
      displayName: summary.name ?? null,
      avatar: summary.avatar ?? null,
      at: summary.likedAt ?? Date.now(),
    }));
    useLikesStore.getState().replaceIncoming(items);
  }, [
    likesQueriesEnabled,
    likesReceivedQuery.isSuccess,
    likesReceivedQuery.data,
  ]);

  const TabsRow: React.FC<{
    hasIncomingLikes: boolean;
    activeTab: typeof MATCHES_TAB_KEY | typeof LIKES_TAB_KEY;
  }> = ({ hasIncomingLikes, activeTab }) => (
    <div className="bg-white">
      <div className="max-w-md mx-auto px-4">
        <div className="flex items-center gap-3 justify-start">
          <button
            type="button"
            onClick={() => changeTab(MATCHES_TAB_KEY)}
            className={[
              "relative px-4 py-2 rounded-full text-sm font-medium text-center transition-colors",
              activeTab === MATCHES_TAB_KEY
                ? "bg-gray-200 text-gray-900"
                : "bg-gray-100 text-gray-500",
            ].join(" ")}
          >
            Matches
          </button>

          <button
            type="button"
            onClick={() => changeTab(LIKES_TAB_KEY)}
            className={[
              "relative px-4 py-2 rounded-full text-sm font-medium text-center transition-colors",
              activeTab === LIKES_TAB_KEY
                ? "bg-gray-200 text-gray-900"
                : "bg-gray-100 text-gray-500",
            ].join(" ")}
          >
            Liked Me
            {activeTab !== LIKES_TAB_KEY && hasIncomingLikes && (
              <span
                className="absolute top-1.5 right-2 w-2 h-2 rounded-full bg-red-500 ring-2 ring-white"
                aria-hidden
              />
            )}
          </button>
        </div>
      </div>
    </div>
  );

  useEffect(() => {
    try {
      sessionStorage.setItem(INBOX_TAB_STORAGE_KEY, tab);
    } catch {
      /* ignore */
    }
  }, [tab]);

  useEffect(() => {
    scrollRestorationRef.current?.restore();
  }, [tab]);

  useEffect(() => {
    return () => {
      scrollRestorationRef.current?.save();
    };
  }, []);

  // Stores

  const byUser = useLikesStore((s) => s.byUser);
  const lastSeenIncomingAt = useLikesStore((s) => s.lastSeenIncomingAt);

  const incomingEntries = useMemo<LikeListEntry[]>(() => {
    const map = new Map<string, LikeListEntry>();

    const upsert = (payload: {
      userId?: string | null;
      username?: string | null;
      at?: number | null;
      matchedAt?: number | null;
      profileHint?: DatingLikeProfile | null;
      displayName?: string | null;
      avatar?: string | null;
    }) => {
      const key = deriveEntryKey(payload.userId, payload.username);
      if (!key) return;
      const username =
        normalizeIdentifier(payload.username) ||
        normalizeIdentifier(payload.userId);
      if (!username) return;
      const likedAt =
        typeof payload.at === "number" &&
        Number.isFinite(payload.at) &&
        payload.at > 0
          ? payload.at
          : Date.now();
      const existing = map.get(key);
      const entry: LikeListEntry = {
        key,
        userId: normalizeIdentifier(payload.userId) || null,
        username,
        at: likedAt,
        matchedAt:
          typeof payload.matchedAt === "number" &&
          Number.isFinite(payload.matchedAt)
            ? payload.matchedAt
            : existing?.matchedAt ?? null,
        profileHint: payload.profileHint ?? existing?.profileHint ?? null,
        displayName: payload.displayName ?? existing?.displayName ?? null,
        avatar: payload.avatar ?? existing?.avatar ?? null,
      };
      if (!existing || entry.at > existing.at) {
        map.set(key, entry);
      } else {
        map.set(key, {
          ...existing,
          matchedAt: entry.matchedAt ?? existing.matchedAt ?? null,
          profileHint: entry.profileHint ?? existing.profileHint ?? null,
          displayName: entry.displayName ?? existing.displayName ?? null,
          avatar: entry.avatar ?? existing.avatar ?? null,
        });
      }
    };

    const summaries = likesReceivedQuery.data ?? [];
    for (const summary of summaries) {
      upsert({
        userId: summary.userId,
        username: summary.username ?? summary.userId,
        at: summary.likedAt ?? null,
        matchedAt: summary.matchedAt ?? null,
        displayName: summary.name ?? null,
        avatar: summary.avatar ?? null,
      });
    }

    for (const entry of Object.values(byUser)) {
      if (!entry?.incoming) continue;
      const hintProfile = entry.incoming.profile || null;
      const photoFromHint =
        hintProfile?.photoUrl ||
        (Array.isArray(hintProfile?.photos)
          ? hintProfile.photos.find(
              (src) => typeof src === "string" && src.trim().length > 0
            )
          : undefined) ||
        null;
      upsert({
        userId: entry.userId ?? hintProfile?.userId ?? null,
        username:
          entry.username ||
          hintProfile?.username ||
          entry.userId ||
          hintProfile?.userId ||
          "",
        at: entry.incoming.at,
        profileHint: hintProfile,
        displayName:
          hintProfile?.displayName ??
          hintProfile?.firstName ??
          entry.username ??
          null,
        avatar: photoFromHint,
      });
    }

    return Array.from(map.values()).sort((a, b) => b.at - a.at);
  }, [likesReceivedQuery.data, byUser]);

  const matchEntries = useMemo<LikeListEntry[]>(() => {
    const map = new Map<string, LikeListEntry>();

    const upsert = (payload: {
      userId?: string | null;
      username?: string | null;
      at?: number | null;
      matchedAt?: number | null;
      profileHint?: DatingLikeProfile | null;
      displayName?: string | null;
      avatar?: string | null;
    }) => {
      const key = deriveEntryKey(payload.userId, payload.username);
      if (!key) return;
      const username =
        normalizeIdentifier(payload.username) ||
        normalizeIdentifier(payload.userId);
      if (!username) return;
      const likedAt =
        typeof payload.at === "number" &&
        Number.isFinite(payload.at) &&
        payload.at > 0
          ? payload.at
          : Date.now();
      const matchedAt =
        typeof payload.matchedAt === "number" &&
        Number.isFinite(payload.matchedAt)
          ? payload.matchedAt
          : null;
      const existing = map.get(key);
      const entry: LikeListEntry = {
        key,
        userId: normalizeIdentifier(payload.userId) || null,
        username,
        at: likedAt,
        matchedAt: matchedAt ?? existing?.matchedAt ?? null,
        profileHint: payload.profileHint ?? existing?.profileHint ?? null,
        displayName: payload.displayName ?? existing?.displayName ?? null,
        avatar: payload.avatar ?? existing?.avatar ?? null,
      };
      if (
        !existing ||
        (entry.matchedAt ?? entry.at) > (existing.matchedAt ?? existing.at)
      ) {
        map.set(key, entry);
      } else {
        map.set(key, {
          ...existing,
          profileHint: entry.profileHint ?? existing.profileHint ?? null,
          displayName: entry.displayName ?? existing.displayName ?? null,
          avatar: entry.avatar ?? existing.avatar ?? null,
        });
      }
    };

    const summaries = matchesQuery.data ?? [];
    for (const summary of summaries) {
      upsert({
        userId: summary.userId,
        username: summary.username ?? summary.userId,
        at: summary.likedAt ?? summary.matchedAt ?? null,
        matchedAt: summary.matchedAt ?? summary.likedAt ?? null,
        displayName: summary.name ?? null,
        avatar: summary.avatar ?? null,
      });
    }

    for (const entry of Object.values(byUser)) {
      const incomingAt = Number(entry?.incoming?.at) || 0;
      const outgoingAt = Number(entry?.outgoing?.at) || 0;
      if (!incomingAt || !outgoingAt) continue;
      const hintProfile =
        entry?.incoming?.profile || entry?.outgoing?.profile || null;
      const photoFromHint =
        hintProfile?.photoUrl ||
        (Array.isArray(hintProfile?.photos)
          ? hintProfile.photos.find(
              (src) => typeof src === "string" && src.trim().length > 0
            )
          : undefined) ||
        null;
      const matchTime = Math.max(incomingAt, outgoingAt);
      upsert({
        userId: entry.userId ?? hintProfile?.userId ?? null,
        username:
          entry.username ||
          hintProfile?.username ||
          entry.userId ||
          hintProfile?.userId ||
          "",
        at: incomingAt,
        matchedAt: matchTime,
        profileHint: hintProfile,
        displayName:
          hintProfile?.displayName ??
          hintProfile?.firstName ??
          entry.username ??
          null,
        avatar: photoFromHint,
      });
    }

    return Array.from(map.values()).sort((a, b) => {
      const aTime = a.matchedAt ?? a.at;
      const bTime = b.matchedAt ?? b.at;
      return bTime - aTime;
    });
  }, [matchesQuery.data, byUser]);

  const profileIdentifiers = useMemo(() => {
    const idSet = new Set<string>();
    const usernameMap = new Map<string, string>();

    const track = (entry: LikeListEntry) => {
      const idValue = normalizeIdentifier(entry.userId);
      if (idValue) idSet.add(idValue);
      const usernameValue = normalizeIdentifier(entry.username);
      if (usernameValue) {
        const lower = usernameValue.toLowerCase();
        if (!usernameMap.has(lower)) usernameMap.set(lower, usernameValue);
      }
      const hint = entry.profileHint;
      if (hint) {
        const hintId = normalizeIdentifier(hint.userId);
        if (hintId) idSet.add(hintId);
        const hintUsername = normalizeIdentifier(hint.username);
        if (hintUsername) {
          const lower = hintUsername.toLowerCase();
          if (!usernameMap.has(lower)) usernameMap.set(lower, hintUsername);
        }
      }
    };

    incomingEntries.forEach(track);
    matchEntries.forEach(track);

    return {
      ids: Array.from(idSet),
      usernames: Array.from(usernameMap.values()),
    };
  }, [incomingEntries, matchEntries]);

  const profileQueryKey = useMemo(() => {
    const sortedIds = [...profileIdentifiers.ids].sort();
    const sortedNames = [...profileIdentifiers.usernames]
      .map((name) => name.toLowerCase())
      .sort();
    return `${sortedIds.join("|")}::${sortedNames.join("|")}`;
  }, [profileIdentifiers]);

  const shouldFetchProfiles =
    likesQueriesEnabled &&
    (profileIdentifiers.ids.length > 0 ||
      profileIdentifiers.usernames.length > 0);

  const profilesQuery = useQuery({
    queryKey: ["datingLikesProfiles", profileQueryKey],
    queryFn: async () => {
      const results: DatingProfile[] = [];
      const seenIds = new Set<string>();
      const seenNames = new Set<string>();

      if (profileIdentifiers.ids.length) {
        const fetchedById = await fetchProfilesByUserIds(
          profileIdentifiers.ids
        );
        for (const profile of fetchedById) {
          if (!profile) continue;
          results.push(profile);
          const idValue = normalizeIdentifier(profile?.userId);
          if (idValue) seenIds.add(idValue);
          const nameValue = normalizeIdentifier(profile?.username);
          if (nameValue) seenNames.add(nameValue.toLowerCase());
        }
      }

      const remainingUsernames = profileIdentifiers.usernames.filter((name) => {
        const normalized = normalizeIdentifier(name).toLowerCase();
        return normalized && !seenNames.has(normalized);
      });

      if (remainingUsernames.length) {
        const fetchedByName = await fetchProfilesByUsernames(
          remainingUsernames
        );
        for (const profile of fetchedByName) {
          if (!profile) continue;
          results.push(profile);
        }
      }

      return results;
    },
    enabled: shouldFetchProfiles,
    staleTime: 60_000,
  });

  const profileMap = useMemo(() => {
    const map = new Map<string, DatingProfile>();
    const list = profilesQuery.data ?? [];
    for (const profile of list) {
      if (!profile) continue;
      const idKey = deriveEntryKey(profile.userId, profile.username);
      if (idKey) map.set(idKey, profile);
      const usernameKey = deriveEntryKey(null, profile.username);
      if (usernameKey) map.set(usernameKey, profile);
    }
    return map;
  }, [profilesQuery.data]);

  const likedMeProfiles = useMemo(
    () =>
      incomingEntries.map((entry) => resolveProfileForEntry(entry, profileMap)),
    [incomingEntries, profileMap]
  );

  const matchesProfiles = useMemo(
    () =>
      matchEntries.map((entry) => resolveProfileForEntry(entry, profileMap)),
    [matchEntries, profileMap]
  );

  const likedMeSignature = useMemo(() => {
    const parts = incomingEntries.map(
      (entry, index) =>
        `${entry.key}:${entry.at}:${entry.userId ?? ""}:${index}`
    );
    if (Array.isArray(profilesQuery.data)) {
      for (const profile of profilesQuery.data) {
        const key = deriveEntryKey(
          profile?.userId ?? null,
          profile?.username ?? null
        );
        if (!key) continue;
        const stamp =
          typeof (profile as any)?.updatedAt === "number"
            ? (profile as any).updatedAt
            : typeof (profile as any)?.datingProfileUpdatedAt === "number"
            ? (profile as any).datingProfileUpdatedAt
            : typeof (profile as any)?.datingProfileCreatedAt === "number"
            ? (profile as any).datingProfileCreatedAt
            : "";
        parts.push(`p:${key}:${stamp}`);
      }
    }
    return parts.join("|");
  }, [incomingEntries, profilesQuery.data]);

  const showIncomingDot = useMemo(() => {
    if (!incomingEntries.length) return false;
    const newest = incomingEntries[0]?.at || 0;
    return newest > (lastSeenIncomingAt || 0);
  }, [incomingEntries, lastSeenIncomingAt]);

  const likedMeLoading =
    likesQueriesEnabled &&
    (likesReceivedQuery.isLoading ||
      (shouldFetchProfiles && profilesQuery.isLoading));
  const likedMeError =
    likesQueriesEnabled &&
    (likesReceivedQuery.isError ||
      (shouldFetchProfiles && profilesQuery.isError));

  const matchesLoading =
    likesQueriesEnabled &&
    (matchesQuery.isLoading ||
      (shouldFetchProfiles && profilesQuery.isLoading));

  const matchesError =
    likesQueriesEnabled &&
    (matchesQuery.isError || (shouldFetchProfiles && profilesQuery.isError));

  const refetchLikesData = useCallback(() => {
    void likesReceivedQuery.refetch();
    void matchesQuery.refetch();
    if (shouldFetchProfiles) {
      void profilesQuery.refetch();
    }
  }, [likesReceivedQuery, matchesQuery, profilesQuery, shouldFetchProfiles]);

  useEffect(() => {
    if (!joined) {
      navigate("/", { replace: true });
    }
  }, [joined, navigate]);

  // Maintain the CSS var for 100dvh on mobile
  useEffect(() => {
    const updateHeight = () =>
      document.documentElement.style.setProperty(
        "--vh",
        `${window.innerHeight * 0.01}px`
      );
    updateHeight();
    window.addEventListener("resize", updateHeight);
    window.addEventListener("orientationchange", updateHeight);
    if ("ontouchstart" in window)
      window.addEventListener("scroll", updateHeight);
    return () => {
      window.removeEventListener("resize", updateHeight);
      window.removeEventListener("orientationchange", updateHeight);
      if ("ontouchstart" in window)
        window.removeEventListener("scroll", updateHeight);
    };
  }, []);

  const handleOpenLikedProfile = useCallback(
    (profile: DatingProfile) => {
      if (!profile) return;
      const target = (profile.username || "").trim();
      if (!target) return;
      scrollRestorationRef.current?.save();
      navigate(`/matches/liked-me/${encodeURIComponent(target)}`, {
        state: { profile },
      });
    },
    [navigate]
  );

  // --- Lazy-loading slices per tab ---
  const PAGE_SIZE = 10;
  const OBS_THRESHOLD = 0.25;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollStorageKey = useMemo(
    () => `${INBOX_SCROLL_STORAGE_KEY_PREFIX}${tab}`,
    [tab]
  );

  // Likes tab slice
  const [visibleLikes, setVisibleLikes] = useState(
    likedMeProfiles.slice(0, PAGE_SIZE)
  );
  const [likesNext, setLikesNext] = useState(
    Math.min(PAGE_SIZE, likedMeProfiles.length)
  );
  const [likesLoadingMore, setLikesLoadingMore] = useState(false);
  const likesHasMore = likesNext < likedMeProfiles.length;
  const likesLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const likesLoadLockRef = useRef(false);

  // Reset slices when source list changes or tab switches
  useEffect(() => {
    const next = likedMeProfiles.slice(0, PAGE_SIZE);
    setVisibleLikes((prev) => {
      if (
        prev.length === next.length &&
        prev.every(
          (profile, index) => profile?.username === next[index]?.username
        )
      )
        return prev;
      return next;
    });
    setLikesNext((prev) => {
      const nextVal = Math.min(PAGE_SIZE, likedMeProfiles.length);
      return prev === nextVal ? prev : nextVal;
    });
  }, [likedMeSignature, likedMeProfiles.length]);

  const loadMoreLikes = React.useCallback(() => {
    if (!likesHasMore || likesLoadingMore || likesLoadLockRef.current) return;
    likesLoadLockRef.current = true;
    setLikesLoadingMore(true);
    Promise.resolve().then(() => {
      const end = Math.min(likesNext + PAGE_SIZE, likedMeProfiles.length);
      const slice = likedMeProfiles.slice(likesNext, end);
      if (slice.length) setVisibleLikes((prev) => [...prev, ...slice]);
      setLikesNext(end);
      setLikesLoadingMore(false);
      setTimeout(() => {
        likesLoadLockRef.current = false;
      }, 250);
    });
  }, [likesHasMore, likesLoadingMore, likesNext, likedMeProfiles]);

  const loadMoreLikesRef = useRef(loadMoreLikes);
  useEffect(() => {
    loadMoreLikesRef.current = loadMoreLikes;
  }, [loadMoreLikes]);

  // Observers per tab
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    let likesObserver: IntersectionObserver | null = null;

    if (tab === LIKES_TAB_KEY && likesLoadMoreRef.current && likesHasMore) {
      const el = likesLoadMoreRef.current;
      likesObserver = new IntersectionObserver(
        (entries, observer) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            if (!likesHasMore || likesLoadLockRef.current) continue;
            likesLoadLockRef.current = true;
            observer.unobserve(entry.target);
            requestAnimationFrame(() => {
              loadMoreLikesRef.current?.();
              setTimeout(() => {
                likesLoadLockRef.current = false;
                if (likesObserver && el) likesObserver.observe(el);
              }, 250);
            });
          }
        },
        { root, threshold: OBS_THRESHOLD }
      );
      likesObserver.observe(el);
    }

    return () => {
      likesObserver?.disconnect();
    };
  }, [tab, likesHasMore]);

  return (
    <div
      className="flex flex-col relative bg-white"
      style={{ height: "calc(var(--vh, 1vh) * 100)", overflowX: "hidden" }}
    >
      <ScrollRestoration
        ref={scrollRestorationRef}
        targetRef={scrollRef as unknown as React.RefObject<HTMLElement | null>}
        storageKey={scrollStorageKey}
      />
      {/* Single scroll container */}
      <div className="flex-1 overflow-y-auto" ref={scrollRef}>
        <PageHeader title="Inbox" />

        {/* Static tabs (no sticky/affix behavior) */}
        <TabsRow hasIncomingLikes={showIncomingDot} activeTab={tab} />

        {/* Content area */}
        <div>
          {tab === MATCHES_TAB_KEY ? (
            <>
              {!hasMyProfile ? (
                <div className="text-center text-sm text-gray-500 py-16">
                  Create a dating profile to see your matches.
                </div>
              ) : matchesLoading ? (
                <div className="py-8 flex justify-center">
                  <LoadingSpinner size={20} label="Loading matches" />
                </div>
              ) : matchesError ? (
                <div className="text-center text-sm text-gray-500 py-16">
                  Unable to load matches right now.
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => refetchLikesData()}
                      className="text-sm font-medium text-primary-600 hover:underline"
                    >
                      Try again
                    </button>
                  </div>
                </div>
              ) : matchesProfiles.length > 0 ? (
                <div className="max-w-md mx-auto px-4 mt-4">
                  <MatchesCard
                    profiles={matchesProfiles}
                    onSelectProfile={handleOpenLikedProfile}
                  />
                </div>
              ) : (
                <div className="text-center text-sm text-gray-500 py-16">
                  No matches yet. When you match with someone, you’ll see them
                  here.
                </div>
              )}
            </>
          ) : (
            <>
              {!hasMyProfile ? (
                <div className="text-center text-sm text-gray-500 py-16">
                  Create a dating profile to see people who liked you.
                </div>
              ) : likedMeLoading ? (
                <div className="py-8 flex justify-center">
                  <LoadingSpinner size={20} label="Loading profiles" />
                </div>
              ) : likedMeError ? (
                <div className="text-center text-sm text-gray-500 py-16">
                  Unable to load profiles right now.
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => refetchLikesData()}
                      className="text-sm font-medium text-primary-600 hover:underline"
                    >
                      Try again
                    </button>
                  </div>
                </div>
              ) : visibleLikes.length > 0 ? (
                <div className="max-w-md mx-auto px-4 mt-4">
                  <div className="grid grid-cols-2 gap-3">
                    {visibleLikes.map((profile, index) => {
                      const name = (profile?.username || "").trim();
                      if (!name) return null;
                      const firstNameValue =
                        (typeof profile?.firstName === "string" &&
                          profile.firstName.trim()) ||
                        (typeof profile?.displayName === "string" &&
                          profile.displayName.trim()) ||
                        "";
                      const photoCandidates: string[] = [];
                      if (Array.isArray(profile?.photos)) {
                        photoCandidates.push(...profile.photos);
                      }
                      if (typeof profile?.photoUrl === "string") {
                        photoCandidates.push(profile.photoUrl);
                      }
                      if (typeof (profile as any)?.photo === "string") {
                        photoCandidates.push((profile as any).photo);
                      }
                      const photosToUse = Array.from(
                        new Set(
                          photoCandidates
                            .filter(
                              (src): src is string =>
                                typeof src === "string" && src.trim().length > 0
                            )
                            .map((src) => src.trim())
                        )
                      );
                      const imageForAvatar =
                        photosToUse[0] || "/placeholder.jpg";
                      return (
                        <LikeCard
                          key={`liked-${name}-${index}`}
                          username={name}
                          firstName={firstNameValue || null}
                          age={
                            typeof profile?.age === "number"
                              ? profile.age
                              : null
                          }
                          photos={photosToUse}
                          imageUrl={imageForAvatar}
                          onOpenProfile={() => handleOpenLikedProfile(profile)}
                        />
                      );
                    })}
                  </div>
                  {likesLoadingMore && (
                    <div className="py-2">
                      <LoadingSpinner size={20} label="Loading more" />
                    </div>
                  )}
                  {likesHasMore && (
                    <div ref={likesLoadMoreRef} className="h-6" aria-hidden />
                  )}
                </div>
              ) : (
                <div className="text-center text-sm text-gray-500 py-16">
                  No likes yet. When someone likes your dating profile, you’ll
                  see them here.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default MatchesPage;
