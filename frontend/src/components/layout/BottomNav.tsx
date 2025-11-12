import React from "react";
import { useNavigate } from "react-router-dom";
import { Home, Flame, Heart, Chat, User } from "../common/Icons";
import { useNotificationStore } from "../../stores/notificationStore";
import { useLikesStore } from "../../stores/likesStore";
import useRoutePrefetch from "../../hooks/useRoutePrefetch";
import { useAuthStore } from "../../stores/authStore";

type BottomNavProps = {
  active: "home" | "direct" | "inbox" | "dating" | "profile" | "none";
};

const BottomNav: React.FC<BottomNavProps> = ({ active }) => {
  const navigate = useNavigate();
  const { userId } = useAuthStore();
  const unreadByGroup = useNotificationStore((s) => s.unreadByGroup);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const homePrefetch = useRoutePrefetch("/");
  const datingPrefetch = useRoutePrefetch("/dating");
  const directPrefetch = useRoutePrefetch("/direct");
  const matchesPrefetch = useRoutePrefetch("/matches");
  const profileTarget = React.useMemo(() => {
    return userId ? `/profile/${encodeURIComponent(userId)}` : "/profile";
  }, [userId]);
  const profilePrefetch = useRoutePrefetch(profileTarget);

  // likes data and last-seen for bell badge
  const byUser = useLikesStore((s) => s.byUser);
  const lastSeenIncomingAt = useLikesStore((s) => s.lastSeenIncomingAt);

  // Direct: number of friends (DM threads) that have any unread
  const totalDmUnread = React.useMemo(
    () =>
      Object.entries(unreadByGroup).reduce(
        (sum, [k, v]) => sum + (k.startsWith("dm:") && (v || 0) > 0 ? 1 : 0),
        0
      ),
    [unreadByGroup]
  );

  // unseen incoming Likes count (increments per user like, not my own)
  const unseenIncomingLikes = React.useMemo(() => {
    const entries = Object.values(byUser);
    let count = 0;
    for (const e of entries) {
      const at = e.incoming?.at ?? 0;
      if (at > lastSeenIncomingAt) count += 1;
    }
    return count;
  }, [byUser, lastSeenIncomingAt]);

  // Badge for Inbox bell: only unseen likes
  const totalInboxBadge = unseenIncomingLikes;

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const node = containerRef.current;
    if (!node) return;
    const setVar = () => {
      const height = node.offsetHeight || 0;
      if (!height) return;
      try {
        document.documentElement.style.setProperty(
          "--app-bottomnav-h",
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

  return (
    <div
      ref={containerRef}
      className="fixed bottom-0 left-0 right-0 z-10 bg-white"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="max-w-md mx-auto h-12 px-3">
        <div className="w-full">
          <div className="grid h-full grid-cols-5">
            {/* Home */}
            <button
              aria-label="Home"
              aria-current={active === "home" ? "page" : undefined}
              {...homePrefetch}
              onClick={() => navigate("/")}
              className={`inline-flex h-12 w-full items-center justify-center transition-all duration-150 ease-out outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0`}
            >
              <span className="relative inline-flex items-center justify-center">
                <Home
                  size={24}
                  weight={active === "home" ? "fill" : "regular"}
                  gradient={active === "home" ? "primaryGradient" : undefined}
                  className="transition-colors duration-150 ease-out"
                />
              </span>
            </button>

            {/* Dating */}
            <button
              aria-label="Dating"
              aria-current={active === "dating" ? "page" : undefined}
              {...datingPrefetch}
              onClick={() => navigate("/dating")}
              className={`inline-flex h-[48px] w-full items-center justify-center transition-all duration-150 ease-out outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0`}
            >
              <span className="relative inline-flex items-center justify-center">
                <Heart
                  size={24}
                  weight={active === "dating" ? "fill" : "regular"}
                  gradient={active === "dating" ? "primaryGradient" : undefined}
                  className="transition-colors duration-150 ease-out"
                />
              </span>
            </button>

            {/* Direct messages (badge = number of friends with unread) */}
            <button
              aria-label="Direct messages"
              aria-current={active === "direct" ? "page" : undefined}
              {...directPrefetch}
              onClick={() => navigate("/direct")}
              className={`inline-flex h-[48px] w-full items-center justify-center transition-all duration-150 ease-out outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0`}
            >
              <span className="relative inline-flex items-center justify-center">
                <span className="relative inline-flex">
                  <Chat
                    size={24}
                    weight={active === "direct" ? "fill" : "regular"}
                    gradient={
                      active === "direct" ? "primaryGradient" : undefined
                    }
                    className="transition-colors duration-150 ease-out"
                  />
                  {totalDmUnread > 0 && (
                    <span className="absolute -top-1 -right-1 h-4 min-w-[1rem] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center ring-2 ring-white">
                      {totalDmUnread > 99 ? "99+" : totalDmUnread}
                    </span>
                  )}
                </span>
              </span>
            </button>

            {/* Matches: combined unread + unseen likes */}
            <button
              aria-label="Matches"
              aria-current={active === "inbox" ? "page" : undefined}
              {...matchesPrefetch}
              onClick={() => navigate("/matches")}
              className={`inline-flex h-[48px] w-full items-center justify-center transition-all duration-150 ease-out outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0`}
            >
              <span className="relative inline-flex items-center justify-center">
                <span className="relative inline-flex">
                  <Flame
                    size={24}
                    weight={active === "inbox" ? "fill" : "regular"}
                    gradient={
                      active === "inbox" ? "primaryGradient" : undefined
                    }
                    className="transition-colors duration-150 ease-out"
                  />
                  {totalInboxBadge > 0 && (
                    <span className="absolute -top-1 -right-1 h-4 min-w-[1rem] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center ring-2 ring-white">
                      {totalInboxBadge > 99 ? "99+" : totalInboxBadge}
                    </span>
                  )}
                </span>
              </span>
            </button>

            {/* Profile */}
            <button
              aria-label="Profile"
              aria-current={active === "profile" ? "page" : undefined}
              {...profilePrefetch}
              onClick={() => navigate(profileTarget)}
              className={`inline-flex h-[48px] w-full items-center justify-center transition-all duration-150 ease-out outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0`}
            >
              <span className="relative inline-flex items-center justify-center">
                <User
                  size={24}
                  weight={active === "profile" ? "fill" : "regular"}
                  gradient={
                    active === "profile" ? "primaryGradient" : undefined
                  }
                  className="transition-colors duration-150 ease-out"
                />
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BottomNav;
