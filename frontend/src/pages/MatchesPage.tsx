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
import { fetchDatingProfile, fetchDatingProfiles } from "../services/api";
import { useDatingStore } from "../stores/datingStore";
import LikeCard from "../components/common/LikeCard";
import MatchesCard from "../components/common/MatchesCard";
import type { DatingProfile } from "../types";
import LoadingSpinner from "../components/ui/LoadingSpinner";
import ScrollRestoration, {
  type ScrollRestorationHandle,
} from "../components/common/ScrollRestoration";
import PageHeader from "../components/common/PageHeader";

const INBOX_TAB_STORAGE_KEY = "__inbox:activeTab";
const INBOX_SCROLL_STORAGE_KEY_PREFIX = "__inbox:scroll:";
const MATCHES_TAB_KEY = "matches" as const;
const LIKES_TAB_KEY = "likes" as const;
const MY_LIKES_TAB_KEY = "myLikes" as const;

const MatchesPage: React.FC = () => {
  const navigate = useNavigate();

  const readStoredTab = ():
    | typeof MATCHES_TAB_KEY
    | typeof LIKES_TAB_KEY
    | typeof MY_LIKES_TAB_KEY => {
    if (typeof window === "undefined") return MATCHES_TAB_KEY;
    try {
      const stored = sessionStorage.getItem(INBOX_TAB_STORAGE_KEY);
      if (
        stored === MATCHES_TAB_KEY ||
        stored === LIKES_TAB_KEY ||
        stored === MY_LIKES_TAB_KEY
      ) {
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
    typeof MATCHES_TAB_KEY | typeof LIKES_TAB_KEY | typeof MY_LIKES_TAB_KEY
  >(readStoredTab());
  const scrollRestorationRef = useRef<ScrollRestorationHandle | null>(null);

  const changeTab = useCallback(
    (
      next:
        | typeof MATCHES_TAB_KEY
        | typeof LIKES_TAB_KEY
        | typeof MY_LIKES_TAB_KEY
    ) => {
      if (tab === next) return;
      scrollRestorationRef.current?.save();
      setTabState(next);
    },
    [tab]
  );

  // Extracted tabs row (static; no sticky/scroll logic)
  // Derive whether I have a profile; if not, hide likes tabs content
  const { userId, username: viewerUsername, joined } = useAuthStore();
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

  const {
    data: datingProfilesRaw = [],
    isLoading: datingProfilesLoading,
    isError: datingProfilesError,
    refetch: refetchDatingProfiles,
  } = useQuery({
    queryKey: ["datingProfiles", viewerUsername || null],
    queryFn: () =>
      fetchDatingProfiles(
        viewerUsername ? { viewer: viewerUsername } : undefined
      ),
    enabled: hasMyProfile,
    staleTime: 60_000,
  });

  const TabsRow: React.FC<{
    hasIncomingLikes: boolean;
    activeTab:
      | typeof MATCHES_TAB_KEY
      | typeof LIKES_TAB_KEY
      | typeof MY_LIKES_TAB_KEY;
  }> = ({ hasIncomingLikes, activeTab }) => (
    <div className="bg-white">
      <div className="max-w-md mx-auto px-4">
        <div className="grid grid-cols-3 gap-3">
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

          <button
            type="button"
            onClick={() => changeTab(MY_LIKES_TAB_KEY)}
            className={[
              "relative px-4 py-2 rounded-full text-sm font-medium text-center transition-colors",
              activeTab === MY_LIKES_TAB_KEY
                ? "bg-gray-200 text-gray-900"
                : "bg-gray-100 text-gray-500",
            ].join(" ")}
          >
            My Likes
            {/* Removed red dot for My Likes */}
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

  // Likes state
  const byUser = useLikesStore((s) => s.byUser);

  const incomingUsernames = React.useMemo(() => {
    const names: string[] = [];
    for (const entry of Object.values(byUser)) {
      if (!entry?.incoming) continue;
      const uname = (entry.username || entry.incoming.profile?.username || "")
        .trim()
        .toLowerCase();
      if (uname) names.push(uname);
    }
    return names;
  }, [byUser]);

  const likedOutgoingUsernames = React.useMemo(() => {
    const names: string[] = [];
    for (const entry of Object.values(byUser)) {
      if (!entry?.outgoing) continue;
      const uname = (entry.username || entry.outgoing.profile?.username || "")
        .trim()
        .toLowerCase();
      if (uname) names.push(uname);
    }
    return names;
  }, [byUser]);

  const incomingSet = React.useMemo(
    () => new Set(incomingUsernames),
    [incomingUsernames]
  );
  const likedOutgoingSet = React.useMemo(
    () => new Set(likedOutgoingUsernames),
    [likedOutgoingUsernames]
  );

  const datingProfiles = React.useMemo(() => {
    if (!Array.isArray(datingProfilesRaw)) return [] as DatingProfile[];
    const seen = new Set<string>();
    const me = (viewerUsername || "").trim().toLowerCase();
    const list: DatingProfile[] = [];
    for (const profile of datingProfilesRaw) {
      if (!profile || typeof profile !== "object") continue;
      const uname = (profile.username || "").trim();
      if (!uname) continue;
      const normalized = uname.toLowerCase();
      if (me && normalized === me) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      list.push(profile);
    }
    return list;
  }, [datingProfilesRaw, viewerUsername]);

  const likedMeProfiles = React.useMemo(() => {
    if (!datingProfiles.length) return [] as DatingProfile[];
    if (incomingSet.size) {
      const matches = datingProfiles.filter((profile) => {
        const uname = (profile?.username || "").trim().toLowerCase();
        return uname && incomingSet.has(uname);
      });
      if (matches.length) return matches;
    }
    const even = datingProfiles.filter((_, idx) => idx % 2 === 0);
    return even.length ? even : datingProfiles;
  }, [datingProfiles, incomingSet]);

  const myLikesProfiles = React.useMemo(() => {
    if (!datingProfiles.length) return [] as DatingProfile[];
    if (likedOutgoingSet.size) {
      const matches = datingProfiles.filter((profile) => {
        const uname = (profile?.username || "").trim().toLowerCase();
        return uname && likedOutgoingSet.has(uname);
      });
      if (matches.length) return matches;
    }
    const odd = datingProfiles.filter((_, idx) => idx % 2 === 1);
    return odd.length ? odd : datingProfiles;
  }, [datingProfiles, likedOutgoingSet]);

  const likedMeSignature = useMemo(
    () =>
      likedMeProfiles
        .map((profile, index) => {
          const uname = (profile?.username || `idx-${index}`).toLowerCase();
          const stamp =
            typeof profile?.updatedAt === "number"
              ? profile.updatedAt
              : typeof profile?.updatedAt === "string"
              ? profile.updatedAt
              : typeof profile?.datingProfileCreatedAt === "number"
              ? profile.datingProfileCreatedAt
              : "";
          return `${uname}:${stamp}`;
        })
        .join("|"),
    [likedMeProfiles]
  );

  const myLikesSignature = useMemo(
    () =>
      myLikesProfiles
        .map((profile, index) => {
          const uname = (profile?.username || `idx-${index}`).toLowerCase();
          const stamp =
            typeof profile?.updatedAt === "number"
              ? profile.updatedAt
              : typeof profile?.updatedAt === "string"
              ? profile.updatedAt
              : typeof profile?.datingProfileCreatedAt === "number"
              ? profile.datingProfileCreatedAt
              : "";
          return `${uname}:${stamp}`;
        })
        .join("|"),
    [myLikesProfiles]
  );

  const showIncomingDot = false;

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

  const handleOpenMyLikedProfile = useCallback(
    (profile: DatingProfile) => {
      if (!profile) return;
      const target = (profile.username || "").trim();
      if (!target) return;
      scrollRestorationRef.current?.save();
      navigate(`/matches/my-likes/${encodeURIComponent(target)}`, {
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

  // My Likes tab slice
  const [visibleMyLikes, setVisibleMyLikes] = useState(
    myLikesProfiles.slice(0, PAGE_SIZE)
  );
  const [myLikesNext, setMyLikesNext] = useState(
    Math.min(PAGE_SIZE, myLikesProfiles.length)
  );
  const [myLikesLoadingMore, setMyLikesLoadingMore] = useState(false);
  const myLikesHasMore = myLikesNext < myLikesProfiles.length;
  const myLikesLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const myLikesLoadLockRef = useRef(false);

  // Reset slices when source lists change or tab switches
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
  useEffect(() => {
    const next = myLikesProfiles.slice(0, PAGE_SIZE);
    setVisibleMyLikes((prev) => {
      if (
        prev.length === next.length &&
        prev.every(
          (profile, index) => profile?.username === next[index]?.username
        )
      )
        return prev;
      return next;
    });
    setMyLikesNext((prev) => {
      const nextVal = Math.min(PAGE_SIZE, myLikesProfiles.length);
      return prev === nextVal ? prev : nextVal;
    });
  }, [myLikesSignature, myLikesProfiles.length]);

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

  const loadMoreMyLikes = React.useCallback(() => {
    if (!myLikesHasMore || myLikesLoadingMore || myLikesLoadLockRef.current)
      return;
    myLikesLoadLockRef.current = true;
    setMyLikesLoadingMore(true);
    Promise.resolve().then(() => {
      const end = Math.min(myLikesNext + PAGE_SIZE, myLikesProfiles.length);
      const slice = myLikesProfiles.slice(myLikesNext, end);
      if (slice.length) setVisibleMyLikes((prev) => [...prev, ...slice]);
      setMyLikesNext(end);
      setMyLikesLoadingMore(false);
      setTimeout(() => {
        myLikesLoadLockRef.current = false;
      }, 250);
    });
  }, [myLikesHasMore, myLikesLoadingMore, myLikesNext, myLikesProfiles]);

  const loadMoreMyLikesRef = useRef(loadMoreMyLikes);
  useEffect(() => {
    loadMoreMyLikesRef.current = loadMoreMyLikes;
  }, [loadMoreMyLikes]);

  // Observers per tab
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    let likesObserver: IntersectionObserver | null = null;
    let myLikesObserver: IntersectionObserver | null = null;

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

    if (
      tab === MY_LIKES_TAB_KEY &&
      myLikesLoadMoreRef.current &&
      myLikesHasMore
    ) {
      const el = myLikesLoadMoreRef.current;
      myLikesObserver = new IntersectionObserver(
        (entries, observer) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            if (!myLikesHasMore || myLikesLoadLockRef.current) continue;
            myLikesLoadLockRef.current = true;
            observer.unobserve(entry.target);
            requestAnimationFrame(() => {
              loadMoreMyLikesRef.current?.();
              setTimeout(() => {
                myLikesLoadLockRef.current = false;
                if (myLikesObserver && el) myLikesObserver.observe(el);
              }, 250);
            });
          }
        },
        { root, threshold: OBS_THRESHOLD }
      );
      myLikesObserver.observe(el);
    }

    return () => {
      likesObserver?.disconnect();
      myLikesObserver?.disconnect();
    };
  }, [tab, likesHasMore, myLikesHasMore]);

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
              ) : datingProfilesLoading ? (
                <div className="py-8 flex justify-center">
                  <LoadingSpinner size={20} label="Loading matches" />
                </div>
              ) : datingProfilesError ? (
                <div className="text-center text-sm text-gray-500 py-16">
                  Unable to load matches right now.
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => void refetchDatingProfiles()}
                      className="text-sm font-medium text-primary-600 hover:underline"
                    >
                      Try again
                    </button>
                  </div>
                </div>
              ) : likedMeProfiles.length > 0 ? (
                <div className="max-w-md mx-auto px-4 mt-4">
                  <MatchesCard
                    profiles={likedMeProfiles}
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
          ) : tab === LIKES_TAB_KEY ? (
            <>
              {!hasMyProfile ? (
                <div className="text-center text-sm text-gray-500 py-16">
                  Create a dating profile to see people who liked you.
                </div>
              ) : datingProfilesLoading ? (
                <div className="py-8 flex justify-center">
                  <LoadingSpinner size={20} label="Loading profiles" />
                </div>
              ) : datingProfilesError ? (
                <div className="text-center text-sm text-gray-500 py-16">
                  Unable to load profiles right now.
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => void refetchDatingProfiles()}
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
          ) : (
            <>
              {!hasMyProfile ? (
                <div className="text-center text-sm text-gray-500 py-16">
                  Create a dating profile to like others.
                </div>
              ) : datingProfilesLoading ? (
                <div className="py-8 flex justify-center">
                  <LoadingSpinner size={20} label="Loading profiles" />
                </div>
              ) : datingProfilesError ? (
                <div className="text-center text-sm text-gray-500 py-16">
                  Unable to load profiles right now.
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => void refetchDatingProfiles()}
                      className="text-sm font-medium text-primary-600 hover:underline"
                    >
                      Try again
                    </button>
                  </div>
                </div>
              ) : visibleMyLikes.length > 0 ? (
                <div className="max-w-md mx-auto px-4 mt-4">
                  <div className="grid grid-cols-2 gap-3">
                    {visibleMyLikes.map((profile, index) => {
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
                          key={`my-like-${name}-${index}`}
                          username={name}
                          firstName={firstNameValue || null}
                          age={
                            typeof profile?.age === "number"
                              ? profile.age
                              : null
                          }
                          photos={photosToUse}
                          imageUrl={imageForAvatar}
                          onOpenProfile={() =>
                            handleOpenMyLikedProfile(profile)
                          }
                        />
                      );
                    })}
                  </div>
                  {myLikesLoadingMore && (
                    <div className="py-2">
                      <LoadingSpinner size={20} label="Loading more" />
                    </div>
                  )}
                  {myLikesHasMore && (
                    <div ref={myLikesLoadMoreRef} className="h-6" aria-hidden />
                  )}
                </div>
              ) : (
                <div className="text-center text-sm text-gray-500 py-16">
                  You haven’t liked anyone yet.
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
