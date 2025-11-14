import React, { useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { SignOut, User, Heart } from "phosphor-react";
import Header from "../components/layout/Header";
import BottomNav from "../components/layout/BottomNav";
import Drawer from "../components/common/Drawer";
import InstallBanner from "../components/layout/InstallBanner";
import IOSInstallTipBanner from "../components/layout/IOSInstallTipBanner";
import { useAuthStore } from "../stores/authStore";
import { fetchDatingProfile, PY_API_URL } from "../services/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDatingStore } from "../stores/datingStore";
import { normalizeAppPath } from "../utils/routes.ts";
import useRoutePrefetch from "../hooks/useRoutePrefetch";
import { useGroupStore } from "../stores/groupStore";
import { prefetchGroupDetails } from "../utils/prefetch";
import { useDatingLikesSync } from "../hooks/useDatingLikesSync";

const AppShell: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.userId);
  const logout = useAuthStore((s) => s.logout);
  const username = useAuthStore((s) => s.username);
  const joined = useAuthStore((s) => s.joined);
  const queryClient = useQueryClient();
  const currentGroup = useGroupStore((s) => s.currentGroup);
  const groups = useGroupStore((s) => s.groups);
  const prefetchedGroupIdsRef = useRef<Set<string>>(new Set());

  // Drawer
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const normalizedPath = normalizeAppPath(location.pathname);

  // Header/BottomNav visibility rules
  const hideHeader =
    /^\/(?:direct(?:\/|$)|inbox(?:\/|$)|matches(?:\/|$)|chat(?:\/|$)|dm\/|dating(?:\/|$)|edit-profile(?:\/|$)|dating-profile(?:\/|$)|edit-dating-profile(?:\/|$)|onboarding(?:\/|$)|u\/|profile(?:\/|$)|emoji-picker(?:\/|$)|gif-picker(?:\/|$))/.test(
      normalizedPath
    );
  const hideBottomNav =
    normalizedPath.startsWith("/matches/liked-me") ||
    /^\/(?:chat(?:\/|$)|dm\/|edit-profile(?:\/|$)|dating-profile(?:\/|$)|edit-dating-profile(?:\/|$)|onboarding(?:\/|$)|u\/|emoji-picker(?:\/|$)|gif-picker(?:\/|$))/.test(
      normalizedPath
    );

  const showHeader = !hideHeader;
  const showBottomNav = !hideBottomNav;

  const activeTab = useMemo<
    "home" | "dating" | "direct" | "inbox" | "profile" | "none"
  >(() => {
    if (normalizedPath.startsWith("/inbox")) return "none";
    if (normalizedPath.startsWith("/dating")) return "dating";
    if (normalizedPath.startsWith("/direct")) return "direct";
    if (normalizedPath.startsWith("/dm/")) return "direct";
    if (normalizedPath.startsWith("/matches")) return "inbox";
    if (normalizedPath.startsWith("/profile")) return "profile";
    return "home";
  }, [normalizedPath]);

  // Dating profile presence
  const { data: serverProfile } = useQuery({
    queryKey: ["datingProfile", userId ?? ""],
    queryFn: () => fetchDatingProfile({ userId }),
    enabled: !!userId,
  });
  const localProfile = useDatingStore((s) => s.profile);
  const effectiveHasProfile = useMemo(() => {
    if (serverProfile !== undefined) {
      if (serverProfile === null) return false;
      const p: any = serverProfile;
      return Boolean(
        p?.photoUrl ||
          (Array.isArray(p?.photos) && p.photos.length > 0) ||
          p?.mood ||
          typeof p?.age === "number" ||
          p?.gender ||
          p?.religion
      );
    }
    return Boolean(localProfile?.photo || (localProfile as any)?.mood);
  }, [serverProfile, localProfile]);

  const profilePrefetchTarget = useMemo(() => {
    return userId ? `/profile/${encodeURIComponent(userId)}` : "/profile/";
  }, [userId]);
  const profilePrefetchHandlers = useRoutePrefetch(profilePrefetchTarget);
  const datingPrefetchTarget = useMemo(() => {
    if (effectiveHasProfile && userId) {
      return `/dating-profile/${encodeURIComponent(userId)}`;
    }
    return "/dating-profile/create";
  }, [effectiveHasProfile, userId]);
  const datingPrefetchHandlers = useRoutePrefetch(datingPrefetchTarget);
  const homePrefetchHandlers = useRoutePrefetch("/");

  useDatingLikesSync(joined ? username : null, {
    enabled: joined,
  });

  // Close drawer on route change
  useEffect(() => {
    setIsDrawerOpen(false);
  }, [normalizedPath]);

  // Precache group metadata when the shell mounts so chat loads instantly on first open.
  useEffect(() => {
    const ids: string[] = [];
    const add = (value?: string | null) => {
      if (!value) return;
      const trimmed = value.trim();
      if (trimmed) ids.push(trimmed);
    };

    add(currentGroup?.id);
    add(currentGroup?.databaseId);

    if (Array.isArray(groups) && groups.length) {
      for (let i = 0; i < groups.length && ids.length < 12; i += 1) {
        const g = groups[i];
        if (!g) continue;
        add(g.id);
        add(g.databaseId);
      }
    }

    if (!ids.length) return;

    const already = prefetchedGroupIdsRef.current;
    const toPrefetch: string[] = [];

    for (const gid of ids) {
      if (already.has(gid)) continue;
      already.add(gid);
      toPrefetch.push(gid);
    }

    if (!toPrefetch.length) return;

    for (const gid of toPrefetch) {
      void prefetchGroupDetails(queryClient, gid);
    }
  }, [queryClient, currentGroup?.id, currentGroup?.databaseId, groups]);

  // Warm the Python API in the background so the first chat navigation doesn't block on cold start.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const base = PY_API_URL.replace(/\/api\/?$/, "").replace(/\/$/, "");
    const url = base ? `${base}/` : `${PY_API_URL.replace(/\/$/, "")}/`;
    const timer = window.setTimeout(() => {
      fetch(url, { mode: "no-cors" }).catch(() => {
        /* best-effort warmup */
      });
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  // Measure header height as CSS var
  useEffect(() => {
    if (!showHeader) return;
    const el = document.querySelector<HTMLDivElement>(".app-header");
    if (!el) return;
    const setVar = () => {
      const h = el.offsetHeight || 0;
      try {
        document.documentElement.style.setProperty("--app-header-h", `${h}px`);
      } catch {}
    };
    setVar();
    const ro = new ResizeObserver(setVar);
    ro.observe(el);
    window.addEventListener("resize", setVar);
    return () => {
      try {
        ro.disconnect();
      } catch {}
      window.removeEventListener("resize", setVar);
    };
  }, [showHeader]);

  return (
    <div className="flex flex-col min-h-screen bg-white">
      {showHeader && (
        <Header
          onAvatarClick={() => setIsDrawerOpen(true)}
          onHeartClick={() => navigate("/inbox")}
        />
      )}

      <Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        position="left"
        width="320px"
      >
        <div className="flex h-full flex-col bg-slate-50 px-4 py-6">
          <div className="space-y-4">
            <div className="overflow-hidden rounded-2xl bg-white">
              <button
                className="flex w-full items-center gap-3 px-5 py-4 text-left text-sm font-medium text-gray-900"
                onClick={() => {
                  setIsDrawerOpen(false);
                  if (!userId) return;
                  navigate(`/profile/${encodeURIComponent(userId)}`);
                }}
                {...(profilePrefetchHandlers ?? {})}
              >
                <User size={22} className="text-gray-700" />
                <span>Profile</span>
              </button>
              <div className="h-px bg-slate-100" />
              <button
                className="flex w-full items-center gap-3 px-5 py-4 text-left text-sm font-medium text-gray-900"
                onClick={() => {
                  setIsDrawerOpen(false);
                  navigate(
                    effectiveHasProfile && userId
                      ? `/dating-profile/${encodeURIComponent(userId)}`
                      : "/dating-profile/create"
                  );
                }}
                {...(datingPrefetchHandlers ?? {})}
              >
                <Heart size={22} className="text-gray-700" />
                <span>Dating profile</span>
              </button>
            </div>

            <div className="overflow-hidden rounded-2xl bg-white">
              <button
                className="flex w-full items-center gap-3 px-5 py-4 text-left text-sm font-medium text-gray-900"
                onClick={() => {
                  logout();
                  setIsDrawerOpen(false);
                  navigate("/", { replace: true });
                }}
                {...(homePrefetchHandlers ?? {})}
              >
                <SignOut size={22} className="text-gray-700" />
                <span>Sign out</span>
              </button>
            </div>
          </div>

          <div className="flex-1" />
        </div>
      </Drawer>

      {/* Top padding uses CSS var from measured header height. Bottom padding accounts for BottomNav and banners. */}
      <div
        className="flex-1 min-h-0"
        style={{
          paddingTop: showHeader ? "var(--app-header-h, 56px)" : undefined,
          paddingBottom: showBottomNav
            ? "calc(var(--app-bottomnav-h, 72px) + max(var(--app-install-banner-h, 0px), var(--app-ios-tip-banner-h, 0px)))"
            : undefined,
        }}
      >
        <Outlet />
      </div>

      {showBottomNav && <BottomNav active={activeTab} />}
      {showBottomNav && <InstallBanner />}
      {showBottomNav && <IOSInstallTipBanner />}
    </div>
  );
};

export default AppShell;
