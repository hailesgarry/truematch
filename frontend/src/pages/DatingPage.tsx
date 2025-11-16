import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { ArrowBendUpLeft, ArrowBendUpRight } from "phosphor-react";
import { useSwipeable } from "react-swipeable";
import type { SwipeEventData, SwipeableHandlers } from "react-swipeable";
import DatingCard from "../components/common/DatingCard";
import PageHeader from "../components/common/PageHeader";
// REMOVED: import Header from "../components/layout/Header";
// REMOVED: import BottomNav from "../components/layout/BottomNav";
import { useAuthStore } from "../stores/authStore";
import { useUiStore } from "../stores/uiStore";
import {
  fetchDatingProfile,
  createDatingLike,
  deleteDatingLike,
} from "../services/api";
import type { DatingProfile } from "../types";
import { deriveDatingProfileKey } from "../utils/dating";
import { useLikesStore } from "../stores/likesStore";
import Modal from "../components/common/Modal";
import { useSocketStore } from "../stores/socketStore";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDatingStore } from "../stores/datingStore";
import {
  useDatingProfilesQuery,
  datingProfilesKey,
} from "../hooks/useDatingProfilesQuery";
import { preDecodeImages, scheduleIdle } from "../utils/imagePipeline.ts";
import DatingCardSkeleton from "../components/common/DatingCardSkeleton";
import { usePreferencesStore } from "../stores/preferencesStore";
import { calculateDistanceMeters } from "../utils/distance";

const sanitizeIdentifier = (value?: string | null): string => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed;
};

const sanitizeUsername = (value?: string | null): string => {
  return sanitizeIdentifier(value);
};

const normalizeUsernameKey = (value?: string | null): string => {
  const trimmed = sanitizeUsername(value);
  return trimmed.toLowerCase();
};

const sanitizePhotoSrc = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const dedupeProfiles = (items: DatingProfile[]): DatingProfile[] => {
  const seen = new Set<string>();
  const unique: DatingProfile[] = [];
  for (const profile of items) {
    const key = deriveDatingProfileKey(profile);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(profile);
  }
  return unique;
};

const collectLikeKeys = (profile: DatingProfile): string[] => {
  const keys = new Set<string>();
  const primaryKey = deriveDatingProfileKey(profile);
  if (primaryKey) keys.add(primaryKey);
  const usernameKey = normalizeUsernameKey(profile?.username);
  if (usernameKey) keys.add(usernameKey);
  return Array.from(keys);
};

interface SwipeHistoryEntry {
  index: number;
  profile: DatingProfile;
  direction: "left" | "right";
}

type LikeMutationTarget = {
  username: string;
  userId?: string | null;
  profile?: DatingProfile;
};

const DatingPage: React.FC = () => {
  const navigate = useNavigate();
  const { joined, userId, token } = useAuthStore();
  const { showToast } = useUiStore();
  const { ensureConnected, likeUser, unlikeUser } = useSocketStore();
  const qc = useQueryClient();
  const byUser = useLikesStore((s) => s.byUser);
  const distanceUnit = usePreferencesStore((s) => s.distanceUnit);
  const [headerHeight, setHeaderHeight] = useState(56);

  const [profiles, setProfiles] = useState<DatingProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeletedBanner, setShowDeletedBanner] = useState(false);
  const profilesQuery = useDatingProfilesQuery(joined);
  const datingQueryKey = datingProfilesKey;
  // Derive "do I have a profile" reactively
  const { data: meProfile } = useQuery({
    queryKey: ["datingProfile", userId ?? ""],
    queryFn: () => fetchDatingProfile({ userId }),
    enabled: !!userId,
  });
  const localProfile = useDatingStore((s) => s.profile);
  const myLocation = useMemo(() => meProfile?.location ?? null, [meProfile]);
  const hasMyProfile = useMemo(() => {
    if (meProfile !== undefined) {
      if (meProfile === null) return false;
      const p: any = meProfile;
      if (p?.hasDatingProfile) return true;
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
  const [showLikeGate, setShowLikeGate] = useState(false);
  const authUserIdValue = useMemo(() => sanitizeIdentifier(userId), [userId]);

  const [currentIndex, setCurrentIndex] = useState(-1);
  const currentIndexRef = useRef(currentIndex);
  const exitTimerRef = useRef<number | null>(null);
  const [dragState, setDragState] = useState({ offsetX: 0, isDragging: false });
  const [leavingCard, setLeavingCard] = useState<{
    index: number;
    direction: "left" | "right";
  } | null>(null);
  const [swipeHistory, setSwipeHistory] = useState<SwipeHistoryEntry[]>([]);
  const updateCurrentIndex = useCallback((value: number) => {
    currentIndexRef.current = value;
    setCurrentIndex(value);
  }, []);

  useEffect(() => {
    ensureConnected();
  }, [ensureConnected]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const selector = ".dating-page-header-inner";
    const node = document.querySelector<HTMLDivElement>(selector);
    if (!node) return;
    let rAF: number | null = null;
    const update = () => {
      const next = node.offsetHeight || 0;
      if (!next) return;
      setHeaderHeight((prev) => (prev === next ? prev : next));
      try {
        document.documentElement.style.setProperty(
          "--dating-page-header-h",
          `${next}px`
        );
      } catch {}
    };
    const schedule = () => {
      if (rAF != null) cancelAnimationFrame(rAF);
      rAF = requestAnimationFrame(update);
    };
    update();
    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(schedule);
      ro.observe(node);
    } catch {}
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("resize", schedule);
      if (rAF != null) cancelAnimationFrame(rAF);
      if (ro) {
        try {
          ro.unobserve(node);
          ro.disconnect();
        } catch {}
      }
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    try {
      document.documentElement.style.setProperty(
        "--dating-page-header-h",
        `${headerHeight}px`
      );
    } catch {}
  }, [headerHeight]);

  // Background refetch on tab visibility regain
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        profilesQuery.refetch();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [profilesQuery.refetch]);

  // One-time banner after deletion
  useEffect(() => {
    try {
      if (sessionStorage.getItem("datingProfileDeleted") === "1") {
        setShowDeletedBanner(true);
        sessionStorage.removeItem("datingProfileDeleted");
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!joined) {
      navigate("/", { replace: true });
      return;
    }
    if (profilesQuery.isLoading) {
      setLoading(true);
      return;
    }
    setLoading(false);
    if (profilesQuery.data) {
      const rawProfiles = Array.isArray(profilesQuery.data)
        ? profilesQuery.data
        : [];
      setProfiles(dedupeProfiles(rawProfiles));
    } else if (profilesQuery.isError) {
      console.error("Failed to load dating profiles:", profilesQuery.error);
      showToast("Dating is temporarily unavailable.", 2500);
    }
  }, [
    joined,
    navigate,
    profilesQuery.isLoading,
    profilesQuery.data,
    profilesQuery.isError,
    profilesQuery.error,
    showToast,
  ]);

  // Optimistic like/unlike using React Query mutations
  const likeMut = useMutation({
    mutationKey: ["dating", "like"],
    mutationFn: async (target: LikeMutationTarget) => {
      // Socket handles server-side; simulate latency-friendly noop
      const targetUsername = (target.username || "").trim();
      if (targetUsername) {
        likeUser(targetUsername, {
          userId: target.userId,
          profile: target.profile,
        });
      }
      const authToken = typeof token === "string" ? token.trim() : "";
      const targetUserId =
        typeof target.userId === "string" ? target.userId.trim() : "";
      if (authToken && targetUserId) {
        try {
          await createDatingLike(targetUserId, authToken);
        } catch (error) {
          console.warn("Failed to persist dating like", error);
        }
      }
      return true as const;
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: datingQueryKey });
      const prev = qc.getQueryData<DatingProfile[]>(datingQueryKey);
      // No change to list itself; UI uses likesStore for heart state
      return { prev };
    },
    onError: (_err, _target, ctx) => {
      // Nothing to rollback in list; likesStore may be adjusted by socket events
      if (ctx?.prev) qc.setQueryData(datingQueryKey, ctx.prev);
    },
  });
  const unlikeMut = useMutation({
    mutationKey: ["dating", "unlike"],
    mutationFn: async (target: LikeMutationTarget) => {
      const targetUsername = (target.username || "").trim();
      if (targetUsername) {
        unlikeUser(targetUsername);
      }
      const authToken = typeof token === "string" ? token.trim() : "";
      const targetUserId =
        typeof target.userId === "string" ? target.userId.trim() : "";
      if (authToken && targetUserId) {
        try {
          await deleteDatingLike(targetUserId, authToken);
        } catch (error) {
          console.warn("Failed to remove dating like", error);
        }
      }
      return true as const;
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: datingQueryKey });
      const prev = qc.getQueryData<DatingProfile[]>(datingQueryKey);
      return { prev };
    },
    onError: (_err, _target, ctx) => {
      if (ctx?.prev) qc.setQueryData(datingQueryKey, ctx.prev);
    },
  });

  const hasAny = profiles.length > 0;

  const handleLike = useCallback(
    (profile: DatingProfile) => {
      const uname = sanitizeUsername(profile?.username);
      if (!uname) return;
      const targetUserId = sanitizeIdentifier(profile?.userId) || null;
      likeMut.mutate({ username: uname, userId: targetUserId, profile });
    },
    [likeMut]
  );

  const handlePass = useCallback((_profile: DatingProfile) => {
    // Reserved for future backend integration to record a "pass" event.
  }, []);

  const resetDragState = useCallback(() => {
    setDragState({ offsetX: 0, isDragging: false });
  }, []);

  const triggerSwipe = useCallback(
    (direction: "left" | "right") => {
      const index = currentIndexRef.current;
      if (index < 0) return;
      if (leavingCard) return;
      const profile = profiles[index];
      if (!profile) return;

      if (direction === "right" && !hasMyProfile) {
        setShowLikeGate(true);
        return;
      }

      resetDragState();
      setLeavingCard({ index, direction });
      if (direction === "right") {
        handleLike(profile);
      } else {
        handlePass(profile);
      }

      if (exitTimerRef.current != null) {
        window.clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
      exitTimerRef.current = window.setTimeout(() => {
        setSwipeHistory((prev) => [...prev, { index, profile, direction }]);
        updateCurrentIndex(index - 1);
        setLeavingCard(null);
        exitTimerRef.current = null;
      }, 280);
    },
    [
      exitTimerRef,
      handleLike,
      handlePass,
      hasMyProfile,
      leavingCard,
      profiles,
      resetDragState,
      setShowLikeGate,
      updateCurrentIndex,
    ]
  );

  const handleRewind = useCallback(() => {
    if (leavingCard) return;
    if (exitTimerRef.current != null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    setSwipeHistory((prev) => {
      if (!prev.length) return prev;
      const last = prev[prev.length - 1];
      const next = prev.slice(0, -1);
      setLeavingCard(null);
      resetDragState();
      updateCurrentIndex(last.index);
      if (last.direction === "right") {
        const uname = sanitizeUsername(last.profile?.username);
        if (uname) {
          const targetUserId = sanitizeIdentifier(last.profile?.userId) || null;
          unlikeMut.mutate({ username: uname, userId: targetUserId });
        }
      }
      return next;
    });
  }, [
    exitTimerRef,
    leavingCard,
    resetDragState,
    unlikeMut,
    updateCurrentIndex,
  ]);

  useEffect(() => {
    if (exitTimerRef.current != null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    updateCurrentIndex(profiles.length - 1);
    setSwipeHistory([]);
    setLeavingCard(null);
    resetDragState();
  }, [profiles, resetDragState, updateCurrentIndex]);

  useEffect(() => {
    return () => {
      if (exitTimerRef.current != null) {
        window.clearTimeout(exitTimerRef.current);
      }
    };
  }, []);

  const swipeHandlers = useSwipeable({
    trackMouse: true,
    trackTouch: true,
    preventScrollOnSwipe: true,
    delta: 20,
    onSwiping: ({ deltaX }: SwipeEventData) => {
      if (leavingCard) return;
      setDragState({ offsetX: deltaX, isDragging: true });
    },
    onSwiped: () => {
      resetDragState();
    },
    onSwipedLeft: () => {
      triggerSwipe("left");
    },
    onSwipedRight: () => {
      triggerSwipe("right");
    },
  });

  // Progressive image UX: pre-decode first row, then idle prefetch next screen
  const decodedOnceRef = useRef(false);
  useEffect(() => {
    if (decodedOnceRef.current) return;
    const cards = (profiles || []).slice(0, 6);
    if (cards.length === 0) return;
    const urls = cards
      .map(
        (p: any) =>
          p.primaryPhotoUrl ||
          p.photoUrl ||
          p.photo ||
          (Array.isArray(p.photos) ? p.photos[0] : null) ||
          p.profileAvatarUrl ||
          p.avatar ||
          p.imageUrl
      )
      .filter(Boolean) as string[];
    if (urls.length === 0) return;
    decodedOnceRef.current = true;
    preDecodeImages(urls);
    // Idle prefetch a few more below the fold
    scheduleIdle(() => {
      const next = (profiles || [])
        .slice(6, 18)
        .map(
          (p: any) =>
            p.primaryPhotoUrl ||
            p.photoUrl ||
            p.photo ||
            (Array.isArray(p.photos) ? p.photos[0] : null) ||
            p.profileAvatarUrl ||
            p.avatar ||
            p.imageUrl
        )
        .filter(Boolean) as string[];
      if (next.length) preDecodeImages(next, true);
    }, 800);
  }, [profiles]);

  const scrollerHeight = useMemo(
    () => `calc(100vh - ${headerHeight}px - var(--app-bottomnav-h, 72px))`,
    [headerHeight]
  );
  const headerPadding = useMemo(() => `${headerHeight}px`, [headerHeight]);

  const lastHistoryEntry =
    swipeHistory.length > 0 ? swipeHistory[swipeHistory.length - 1] : null;
  const rewindDisabled = !lastHistoryEntry || leavingCard !== null;
  const rewindIcon = lastHistoryEntry ? (
    lastHistoryEntry.direction === "right" ? (
      <ArrowBendUpLeft size={24} />
    ) : (
      <ArrowBendUpRight size={24} />
    )
  ) : (
    <ArrowBendUpRight size={24} />
  );
  const rewindLabel = lastHistoryEntry
    ? lastHistoryEntry.direction === "right"
      ? "Undo like"
      : "Undo pass"
    : "Nothing to rewind";
  const rewindButton = (
    <button
      type="button"
      onClick={handleRewind}
      disabled={rewindDisabled}
      aria-label={rewindLabel}
      className={`flex items-center justify-center transition ${
        rewindDisabled ? "text-gray-300" : "text-gray-700 hover:text-gray-900"
      }`}
    >
      {rewindIcon}
    </button>
  );
  return (
    <div className="bg-white text-gray-900">
      <PageHeader
        right={rewindButton}
        position="fixed"
        containerClassName="max-w-md mx-auto dating-page-header-inner"
      />
      <div className="pt-14" style={{ paddingTop: headerPadding }}>
        <div className="mx-auto w-full max-w-md px-4">
          {showDeletedBanner && (
            <div className="mb-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              Your dating profile was deleted.
            </div>
          )}
        </div>
        <div
          className="mx-auto flex w-full max-w-md flex-col px-2"
          style={{ minHeight: scrollerHeight }}
        >
          {loading ? (
            <div className="flex flex-1 items-center justify-center py-6">
              <DatingCardSkeleton className="h-full max-h-[520px] w-full" />
            </div>
          ) : !hasAny ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <p className="mb-4 text-sm text-gray-500">
                No dating profiles yet. Be the first to create one!
              </p>
              <button
                type="button"
                onClick={() => navigate("/dating-profile/create")}
                className="inline-flex items-center justify-center rounded-lg bg-red-500 px-4 py-2.5 font-semibold text-white shadow transition hover:bg-red-600"
              >
                Create Dating Profile
              </button>
            </div>
          ) : currentIndex < 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <p className="text-sm text-gray-500">
                You&apos;re all caught up for now. Check back soon!
              </p>
            </div>
          ) : (
            <>
              <div
                className="relative flex-1 py-4"
                style={{ minHeight: "420px" }}
              >
                {profiles.map((p: DatingProfile, index) => {
                  if (index > currentIndex) return null;

                  const stackPosition = currentIndex - index;
                  const depth = Math.min(stackPosition, 3);
                  const scale =
                    stackPosition === 0 ? 1 : Math.max(0.9, 1 - depth * 0.04);
                  const translateY = stackPosition === 0 ? 0 : depth * 14;
                  const opacity =
                    stackPosition === 0 ? 1 : Math.max(0.5, 1 - depth * 0.08);
                  const isTop = stackPosition === 0;
                  const isLeaving = leavingCard?.index === index;

                  const primaryPhotoSrc =
                    sanitizePhotoSrc(p.primaryPhotoUrl) ||
                    sanitizePhotoSrc(p.photoUrl) ||
                    sanitizePhotoSrc(p.photo) ||
                    (Array.isArray(p.photos)
                      ? (p.photos
                          .map((src) => sanitizePhotoSrc(src))
                          .find((src) => Boolean(src)) as string | null) ?? null
                      : null) ||
                    sanitizePhotoSrc(p.profileAvatarUrl);
                  const galleryPhotos = Array.isArray(p.photos)
                    ? p.photos
                        .map((src) => sanitizePhotoSrc(src))
                        .filter((src): src is string => Boolean(src))
                    : [];
                  const profileAvatarSrc = sanitizePhotoSrc(p.profileAvatarUrl);
                  const orderedPhotos: string[] = [];
                  const pushPhoto = (src: string | null) => {
                    if (!src) return;
                    if (orderedPhotos.includes(src)) return;
                    orderedPhotos.push(src);
                  };
                  pushPhoto(primaryPhotoSrc);
                  galleryPhotos.forEach((src) => pushPhoto(src));
                  pushPhoto(profileAvatarSrc);
                  const imageUrl = orderedPhotos[0] || "/placeholder.jpg";
                  const photosArr = orderedPhotos;
                  const uname = sanitizeUsername(p.username) || "";
                  const likeKeyCandidates = collectLikeKeys(p);
                  const firstNameValue =
                    (typeof p.firstName === "string" && p.firstName.trim()) ||
                    (typeof p.displayName === "string" &&
                      p.displayName.trim()) ||
                    "";
                  const profileUserId = sanitizeIdentifier(p.userId);
                  const identityKey =
                    deriveDatingProfileKey(p) ||
                    (normalizeUsernameKey(uname)
                      ? `name:${normalizeUsernameKey(uname)}`
                      : profileUserId
                      ? `id:${profileUserId}`
                      : "");
                  const profileRevision = (() => {
                    if (typeof p.updatedAt === "string") return p.updatedAt;
                    if (typeof p.updatedAt === "number")
                      return String(p.updatedAt);
                    if (typeof p.createdAt === "string") return p.createdAt;
                    if (typeof p.createdAt === "number")
                      return String(p.createdAt);
                    return String(index);
                  })();
                  const profileKey = `${identityKey || `profile:${index}`}::${
                    profileRevision || index
                  }`;
                  const liked = likeKeyCandidates.some((key) =>
                    Boolean(byUser[key]?.outgoing)
                  );
                  const cityValue = sanitizeIdentifier(p.location?.city);
                  const stateValue = sanitizeIdentifier(p.location?.state);
                  const countryValue = sanitizeIdentifier(p.location?.country);
                  const fallbackLocation =
                    sanitizeIdentifier(p.location?.formatted) ||
                    [countryValue, stateValue, cityValue]
                      .filter((part) => part.length > 0)
                      .join(", ") ||
                    "";
                  const distanceMeters = calculateDistanceMeters(
                    myLocation,
                    p.location ?? null
                  );

                  const zIndex = Math.max(1, 1000 - stackPosition);

                  const transformParts: string[] = [];
                  if (!isTop) {
                    transformParts.push(`scale(${scale})`);
                    transformParts.push(`translateY(${translateY}px)`);
                  }

                  let cardOpacity = opacity;
                  if (isTop) {
                    if (isLeaving && leavingCard) {
                      const exitX =
                        leavingCard.direction === "right" ? 640 : -640;
                      const exitRotate =
                        leavingCard.direction === "right" ? 22 : -22;
                      transformParts.push(`translate(${exitX}px, -60px)`);
                      transformParts.push(`rotate(${exitRotate}deg)`);
                      cardOpacity = 0;
                    } else if (dragState.isDragging) {
                      const dragY = dragState.offsetX * -0.04;
                      const rotation = dragState.offsetX * 0.08;
                      transformParts.push(
                        `translate(${dragState.offsetX}px, ${dragY}px)`
                      );
                      transformParts.push(`rotate(${rotation}deg)`);
                      cardOpacity = Math.max(
                        0.65,
                        1 - Math.min(Math.abs(dragState.offsetX) / 600, 0.35)
                      );
                    }
                  }

                  const transform = transformParts.join(" ") || undefined;
                  const transition =
                    isTop && dragState.isDragging && !isLeaving
                      ? "none"
                      : "transform 0.32s ease-out, opacity 0.32s ease-out";

                  const handlerProps:
                    | SwipeableHandlers
                    | Record<string, never> =
                    isTop && !isLeaving ? swipeHandlers : {};

                  return (
                    <div
                      key={profileKey}
                      className="absolute inset-0 flex items-center justify-center"
                      style={{
                        zIndex,
                        pointerEvents: isTop && !isLeaving ? "auto" : "none",
                      }}
                    >
                      <div
                        className="h-full w-full"
                        style={{
                          transform,
                          opacity: cardOpacity,
                          transition,
                          touchAction: isTop ? "pan-y" : "none",
                        }}
                        {...handlerProps}
                      >
                        <DatingCard
                          firstName={firstNameValue}
                          username={uname}
                          age={p.age}
                          status={p.mood || ""}
                          imageUrl={imageUrl}
                          photos={photosArr}
                          city={cityValue}
                          state={stateValue}
                          country={countryValue}
                          locationLabel={fallbackLocation}
                          liked={liked}
                          className="h-full max-h-full"
                          distanceMeters={distanceMeters ?? null}
                          distanceUnit={distanceUnit}
                          matchPercentage={p.matchPercentage ?? null}
                          interceptLike={() => {
                            if (!hasMyProfile) {
                              setShowLikeGate(true);
                              return true;
                            }
                            return false;
                          }}
                          onLike={() => {
                            if (isTop) {
                              triggerSwipe("right");
                              return;
                            }
                            handleLike(p);
                          }}
                          onUnlike={() => {
                            if (!uname) return;
                            unlikeMut.mutate({
                              username: uname,
                              userId: profileUserId || null,
                            });
                          }}
                          onOpenProfile={() => {
                            const profileId = profileUserId;
                            const isOwner =
                              Boolean(authUserIdValue) &&
                              Boolean(profileId) &&
                              profileId === authUserIdValue;
                            const nextPath =
                              !isOwner && profileId
                                ? `/dating-profile/${encodeURIComponent(
                                    profileId
                                  )}`
                                : "/dating-profile";
                            navigate(nextPath, {
                              state: {
                                profile: p,
                                allowEdit: isOwner,
                                hideTitle: !isOwner,
                                preview: !isOwner,
                              },
                            });
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* BottomNav is provided by AppShell; no extra spacer needed */}
      <Modal
        isOpen={showLikeGate}
        onClose={() => setShowLikeGate(false)}
        title="Create a dating profile"
        ariaDescription="To like people, you need to create a dating profile."
        size="md"
        centered
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            You can’t use Likes yet. Create your dating profile so others can
            get to know you.
          </p>
          <div className="grid gap-2">
            <button
              type="button"
              onClick={() => navigate("/dating-profile/create")}
              className="w-full px-4 py-2 rounded-md bg-red-600 text-white"
              data-autofocus
            >
              Create dating profile
            </button>
            <button
              type="button"
              onClick={() => setShowLikeGate(false)}
              className="w-full px-4 py-2 rounded-md border text-gray-900"
            >
              Not now
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default DatingPage;
