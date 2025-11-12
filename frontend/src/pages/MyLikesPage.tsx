import React from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowBendUpRight } from "phosphor-react";
import PageHeader from "../components/common/PageHeader";
import DatingCard from "../components/common/DatingCard";
import LoadingSpinner from "../components/ui/LoadingSpinner";
import { fetchDatingProfile } from "../services/api";
import type { DatingProfile } from "../types";

type MyLikesLocationState = {
  profile?: DatingProfile | null;
};

const MyLikesPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { username: rawUsername = "" } = useParams<{ username: string }>();

  const username = React.useMemo(() => rawUsername.trim(), [rawUsername]);
  const locationState = location.state as MyLikesLocationState | undefined;
  const stateProfile = locationState?.profile ?? null;

  const {
    data: fetchedProfile,
    isLoading,
    isFetching,
    isError,
    refetch,
  } = useQuery<DatingProfile | null>({
    queryKey: ["myLikesProfile", username.toLowerCase()],
    queryFn: () => fetchDatingProfile({ username }),
    enabled: username.length > 0,
    initialData: stateProfile ?? undefined,
  });

  const profile = React.useMemo(() => {
    if (stateProfile && fetchedProfile) {
      const merged: DatingProfile = {
        ...stateProfile,
        ...fetchedProfile,
      };
      if (
        stateProfile.matchPercentage !== undefined &&
        stateProfile.matchPercentage !== null
      ) {
        merged.matchPercentage = stateProfile.matchPercentage;
      } else if (
        fetchedProfile.matchPercentage !== undefined &&
        fetchedProfile.matchPercentage !== null
      ) {
        merged.matchPercentage = fetchedProfile.matchPercentage;
      } else {
        merged.matchPercentage = null;
      }
      return merged;
    }
    return fetchedProfile ?? stateProfile;
  }, [fetchedProfile, stateProfile]);

  const photosInfo = React.useMemo(() => {
    if (!profile) {
      return { photos: [] as string[], primaryImage: "/placeholder.jpg" };
    }
    const candidates: string[] = [];
    if (Array.isArray(profile.photos)) {
      candidates.push(...profile.photos);
    }
    if (typeof profile.photoUrl === "string") {
      candidates.push(profile.photoUrl);
    }
    if (typeof profile.photo === "string") {
      candidates.push(profile.photo);
    }

    const unique = Array.from(
      new Set(
        candidates
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter((value) => value.length > 0)
      )
    );

    const fallback = unique[0] || "/placeholder.jpg";

    return { photos: unique, primaryImage: fallback };
  }, [profile]);

  const geo = profile?.location ?? null;
  const firstName = React.useMemo(() => {
    if (!profile) return "";
    const parts = [profile.firstName, profile.displayName]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter((value) => value.length > 0);
    return parts[0] || profile.username || "";
  }, [profile]);

  const handleBack = React.useCallback(() => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate("/inbox", { replace: true });
  }, [navigate]);

  const showLoading = (isLoading || isFetching) && !profile;

  const [headerHeight, setHeaderHeight] = React.useState(48);
  const bottomNavRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const node = bottomNavRef.current;
    if (!node) return;
    const setVar = () => {
      const height = node.offsetHeight || 0;
      if (!height) return;
      try {
        document.documentElement.style.setProperty(
          "--my-likes-bottomnav-h",
          `${height}px`
        );
      } catch {}
    };
    setVar();
    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(setVar);
      ro.observe(node);
    } catch {}
    window.addEventListener("resize", setVar);
    return () => {
      window.removeEventListener("resize", setVar);
      if (ro) {
        try {
          ro.unobserve(node);
          ro.disconnect();
        } catch {}
      }
    };
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const selector = ".my-likes-page-header-inner";
    const node = document.querySelector<HTMLDivElement>(selector);
    if (!node) return;
    let rAF: number | null = null;
    const update = () => {
      const next = node.offsetHeight || 0;
      if (!next) return;
      setHeaderHeight((prev) => (prev === next ? prev : next));
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

  const containerHeight = React.useMemo(
    () => `calc(100vh - ${headerHeight}px - var(--my-likes-bottomnav-h, 48px))`,
    [headerHeight]
  );

  return (
    <div className="bg-white text-gray-900">
      <PageHeader
        title="My Likes"
        onBack={handleBack}
        position="fixed"
        containerClassName="max-w-md mx-auto my-likes-page-header-inner"
        heightClassName="h-12"
      />
      <div className="pt-12" style={{ paddingTop: `${headerHeight}px` }}>
        <div
          className="mx-auto w-full max-w-md"
          style={{ height: containerHeight }}
        >
          {showLoading ? (
            <div className="flex h-full items-center justify-center px-4">
              <LoadingSpinner size={20} label="Loading profile" />
            </div>
          ) : profile ? (
            <div className="h-full p-1">
              <div className="flex h-full items-center justify-center">
                <DatingCard
                  className="h-full max-h-full"
                  firstName={firstName}
                  username={profile.username}
                  status={typeof profile.mood === "string" ? profile.mood : ""}
                  age={
                    typeof profile.age === "number" ? profile.age : undefined
                  }
                  imageUrl={photosInfo.primaryImage}
                  photos={photosInfo.photos}
                  city={geo?.city ?? undefined}
                  state={geo?.state ?? undefined}
                  country={geo?.country ?? undefined}
                  locationLabel={geo?.formatted ?? undefined}
                  matchPercentage={profile.matchPercentage ?? null}
                />
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center px-4">
              <div className="w-full max-w-md rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
                {isError
                  ? "We couldn't load this profile right now."
                  : "This profile is no longer available."}
                <div className="mt-4 flex justify-center gap-3">
                  {isError && (
                    <button
                      type="button"
                      onClick={() => void refetch()}
                      className="rounded-full bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-500"
                    >
                      Try again
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleBack}
                    className="rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Back to inbox
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Navigation */}
      <div
        ref={bottomNavRef}
        className="fixed bottom-0 left-0 right-0 z-10 bg-white"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="max-w-md mx-auto h-12 px-3">
          <div className="w-full h-full flex items-center">
            <button
              aria-label="Go back"
              onClick={handleBack}
              className="inline-flex h-12 items-center justify-center px-3 transition-all duration-150 ease-out outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0"
            >
              <ArrowBendUpRight size={24} className="text-gray-900" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MyLikesPage;
