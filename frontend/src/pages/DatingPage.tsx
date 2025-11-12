import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { ArrowBendUpRight } from "phosphor-react";
import DatingCard from "../components/common/DatingCard";
import PageHeader from "../components/common/PageHeader";
// REMOVED: import Header from "../components/layout/Header";
// REMOVED: import BottomNav from "../components/layout/BottomNav";
import { useAuthStore } from "../stores/authStore";
import { useUiStore } from "../stores/uiStore";
import { fetchDatingProfile } from "../services/api";
import type { DatingProfile } from "../types";
import { filterProfilesByPreferences } from "../utils/dating";
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

const normalizeUsername = (value: string | null | undefined): string => {
  if (!value) return "";
  return value.trim();
};

const SCROLL_STORAGE_KEY = "__scroll:dating";

const dedupeProfiles = (items: DatingProfile[]): DatingProfile[] => {
  const seen = new Set<string>();
  const unique: DatingProfile[] = [];
  for (const profile of items) {
    const raw = normalizeUsername(profile?.username);
    if (!raw) {
      continue;
    }
    const key = raw.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(profile);
  }
  return unique;
};

const DatingPage: React.FC = () => {
  const navigate = useNavigate();
  const { joined, username, userId } = useAuthStore();
  const { showToast } = useUiStore();
  const { ensureConnected, likeUser, unlikeUser } = useSocketStore();
  const qc = useQueryClient();
  const byUser = useLikesStore((s) => s.byUser);
  const distanceUnit = usePreferencesStore((s) => s.distanceUnit);
  const [headerHeight, setHeaderHeight] = useState(56);

  const [profiles, setProfiles] = useState<DatingProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeletedBanner, setShowDeletedBanner] = useState(false);
  const viewerKey = useMemo(
    () => (username ? username.trim() : ""),
    [username]
  );
  const profilesQuery = useDatingProfilesQuery(
    joined,
    viewerKey ? viewerKey : undefined
  );
  const datingQueryKey = useMemo(
    () => [...datingProfilesKey, viewerKey] as const,
    [viewerKey]
  );
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
  const authUserIdValue = useMemo(
    () => (userId ? userId.trim() : ""),
    [userId]
  );

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const setScrollerNode = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      scrollerRef.current = null;
      return;
    }
    scrollerRef.current = node;
    try {
      const stored = Number(sessionStorage.getItem(SCROLL_STORAGE_KEY) || "0");
      if (Number.isFinite(stored)) {
        node.scrollTop = stored;
      }
    } catch {}
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

  // Keep-alive scroll position for dating list
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const onScroll = () => {
      try {
        sessionStorage.setItem(SCROLL_STORAGE_KEY, String(node.scrollTop));
      } catch {}
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, []);

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
      const active = dedupeProfiles(
        (profilesQuery.data || []).filter((profile) => {
          if (typeof profile?.hasDatingProfile === "boolean") {
            return profile.hasDatingProfile;
          }
          const fallback = Boolean(
            (Array.isArray(profile?.photos) && profile.photos.length > 0) ||
              profile?.photoUrl ||
              profile?.photo ||
              profile?.mood ||
              typeof profile?.age === "number" ||
              profile?.gender ||
              profile?.interestedIn
          );
          return fallback;
        })
      );
      const withoutSelf = active.filter(
        (p) =>
          (p.username || "").toLowerCase() !== (username || "").toLowerCase()
      );
      const filtered = dedupeProfiles(
        filterProfilesByPreferences(withoutSelf, username)
      );
      const withPhoto = filtered.filter(
        (p) =>
          (Array.isArray(p.photos) && p.photos.length > 0) ||
          p.photoUrl ||
          p.photo
      );
      setProfiles(dedupeProfiles(withPhoto.length ? withPhoto : filtered));
    } else if (profilesQuery.isError) {
      console.error("Failed to load dating profiles:", profilesQuery.error);
      showToast("Dating is temporarily unavailable.", 2500);
    }
  }, [
    joined,
    navigate,
    username,
    profilesQuery.isLoading,
    profilesQuery.data,
    profilesQuery.isError,
    profilesQuery.error,
    showToast,
  ]);

  // Optimistic like/unlike using React Query mutations
  const likeMut = useMutation({
    mutationKey: ["dating", "like"],
    mutationFn: async (target: string) => {
      // Socket handles server-side; simulate latency-friendly noop
      likeUser(target);
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
    mutationFn: async (target: string) => {
      unlikeUser(target);
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

  // Lazy-loading config for visible slice
  const PAGE_SIZE = 12; // number of cards to append per batch
  const OBS_THRESHOLD = 0.25; // when 25% of sentinel is visible, load next

  const [visible, setVisible] = useState<DatingProfile[]>([]);
  const [nextIndex, setNextIndex] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const hasMore = nextIndex < profiles.length;

  const renderedProfiles = useMemo(() => dedupeProfiles(visible), [visible]);

  // Reset visible list when the full profiles list changes
  useEffect(() => {
    if (!profiles.length) {
      setVisible([]);
      setNextIndex(0);
      return;
    }
    const initial = profiles.slice(0, PAGE_SIZE);
    setVisible(initial);
    setNextIndex(initial.length);
  }, [profiles]);

  const loadNextBatch = useCallback(() => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    Promise.resolve().then(() => {
      const end = Math.min(nextIndex + PAGE_SIZE, profiles.length);
      const slice = profiles.slice(nextIndex, end);
      if (slice.length) setVisible((prev) => [...prev, ...slice]);
      setNextIndex(end);
      setLoadingMore(false);
    });
  }, [hasMore, loadingMore, nextIndex, profiles]);

  // IntersectionObserver to append when sentinel enters viewport
  useEffect(() => {
    const el = loadMoreRef.current;
    const root = scrollerRef.current;
    if (!el || !root) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && hasMore && !loadingMore && !loading) {
            loadNextBatch();
          }
        }
      },
      { root, threshold: OBS_THRESHOLD }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loadingMore, loading, loadNextBatch]);

  // Progressive image UX: pre-decode first row, then idle prefetch next screen
  const decodedOnceRef = useRef(false);
  useEffect(() => {
    if (decodedOnceRef.current) return;
    const cards = (profiles || []).slice(0, 6);
    if (cards.length === 0) return;
    const urls = cards
      .map((p: any) => p.photo || p.avatar || p.imageUrl)
      .filter(Boolean) as string[];
    if (urls.length === 0) return;
    decodedOnceRef.current = true;
    preDecodeImages(urls);
    // Idle prefetch a few more below the fold
    scheduleIdle(() => {
      const next = (profiles || [])
        .slice(6, 18)
        .map((p: any) => p.photo || p.avatar || p.imageUrl)
        .filter(Boolean) as string[];
      if (next.length) preDecodeImages(next, true);
    }, 800);
  }, [profiles]);

  const scrollerHeight = useMemo(
    () => `calc(100vh - ${headerHeight}px - var(--app-bottomnav-h, 72px))`,
    [headerHeight]
  );
  const headerPadding = useMemo(() => `${headerHeight}px`, [headerHeight]);
  return (
    <div className="bg-white text-gray-900">
      <PageHeader
        onBack={() => navigate(-1)}
        backIcon={<ArrowBendUpRight size={24} />}
        position="fixed"
        containerClassName="max-w-md mx-auto dating-page-header-inner"
        heightClassName="h-12"
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
          ref={setScrollerNode}
          className="mx-auto w-full max-w-md snap-y snap-mandatory overflow-y-auto scroll-smooth"
          style={{ height: scrollerHeight }}
        >
          {loading ? (
            <div className="snap-start snap-always h-full p-1">
              <div className="flex h-full items-center justify-center">
                <DatingCardSkeleton className="h-full max-h-full" />
              </div>
            </div>
          ) : !hasAny ? (
            <div className="snap-start snap-always h-full px-4">
              <div className="flex h-full flex-col items-center justify-center text-center">
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
            </div>
          ) : (
            <>
              {renderedProfiles.map((p: DatingProfile, index) => {
                const normalizePhotoSrc = (value: unknown): string => {
                  if (typeof value !== "string") return "";
                  const trimmed = value.trim();
                  return trimmed.length ? trimmed : "";
                };
                const primaryPhotoSrc =
                  normalizePhotoSrc(p.photoUrl) || normalizePhotoSrc(p.photo);
                const galleryPhotos = Array.isArray(p.photos)
                  ? p.photos.map(normalizePhotoSrc).filter((src) => src)
                  : [];
                const orderedPhotos: string[] = [];
                if (primaryPhotoSrc) {
                  orderedPhotos.push(primaryPhotoSrc);
                }
                for (const src of galleryPhotos) {
                  if (!orderedPhotos.includes(src)) {
                    orderedPhotos.push(src);
                  }
                }
                const imageUrl = orderedPhotos[0] || "/placeholder.jpg";
                const photosArr = orderedPhotos;
                const uname = p.username;
                const normalizedName = normalizeUsername(uname) || "profile";
                const firstNameValue =
                  (typeof p.firstName === "string" && p.firstName.trim()) ||
                  (typeof p.displayName === "string" && p.displayName.trim()) ||
                  "";
                const profileUserId =
                  typeof p.userId === "string" ? p.userId : "";
                const profileKey = [
                  profileUserId || normalizedName,
                  p.updatedAt ?? p.createdAt ?? "",
                  index,
                ].join("::");
                const liked = !!byUser[uname.toLowerCase()]?.outgoing;
                const cityValue = p.location?.city?.trim() || "";
                const stateValue = p.location?.state?.trim() || "";
                const countryValue = p.location?.country?.trim() || "";
                const fallbackLocation =
                  p.location?.formatted?.trim() ||
                  [countryValue, stateValue, cityValue]
                    .filter((part) => part.length > 0)
                    .join(", ") ||
                  "";
                const distanceMeters = calculateDistanceMeters(
                  myLocation,
                  p.location ?? null
                );

                return (
                  <section
                    key={profileKey}
                    className="snap-start snap-always h-full p-1"
                  >
                    <div className="flex h-full items-center justify-center">
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
                        onLike={() => likeMut.mutate(uname)}
                        onUnlike={() => unlikeMut.mutate(uname)}
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
                  </section>
                );
              })}
              {loadingMore && (
                <div className="snap-start snap-always h-full p-1">
                  <div className="flex h-full items-center justify-center">
                    <DatingCardSkeleton className="h-full max-h-full" />
                  </div>
                </div>
              )}
              {hasMore && <div ref={loadMoreRef} className="h-1" aria-hidden />}
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
