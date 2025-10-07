import React from "react";
import { useNavigate } from "react-router-dom";
import {
  UsersThree,
  BellSimple,
  Heart,
  ChatCenteredDots,
} from "phosphor-react";
import { useNotificationStore } from "../../stores/notificationStore";
import { useLikesStore } from "../../stores/likesStore";

type BottomNavProps = {
  active: "home" | "direct" | "inbox" | "dating";
};

const BottomNav: React.FC<BottomNavProps> = ({ active }) => {
  const navigate = useNavigate();
  const unreadByGroup = useNotificationStore((s) => s.unreadByGroup);

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

  // Inbox: number of groups (non-DM) that have any unread messages
  const totalInboxUnreadGroups = React.useMemo(
    () =>
      Object.entries(unreadByGroup).reduce(
        (sum, [k, v]) => sum + (!k.startsWith("dm:") && (v || 0) > 0 ? 1 : 0),
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

  // combined badge for Inbox bell
  const totalInboxBadge = totalInboxUnreadGroups + unseenIncomingLikes;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-10">
      {/* Slightly taller bar */}
      <div className="max-w-md mx-auto h-[72px] px-2">
        {/* Four equal tabs */}
        <div className="grid h-full grid-cols-4">
          {/* Home */}
          <button
            aria-label="Home"
            aria-current={active === "home" ? "page" : undefined}
            onClick={() => navigate("/groups")}
            className={`inline-flex h-[72px] w-full flex-col items-center justify-center gap-1 transition-all duration-150 ease-out outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0`}
          >
            <span
              className={
                (active === "home" ? "bg-red-50 px-5 py-1 " : "px-3 py-1 ") +
                "relative inline-flex items-center justify-center rounded-full transition-colors duration-150 ease-out"
              }
            >
              <UsersThree
                size={24}
                weight={active === "home" ? "fill" : "regular"}
                className={
                  (active === "home" ? "text-red-500" : "text-gray-900") +
                  " transition-colors duration-150 ease-out"
                }
              />
            </span>
            <span
              className={
                `text-xs leading-none transition-colors duration-150 ease-out ` +
                (active === "home" ? "text-red-500 font-bold" : "text-gray-900")
              }
            >
              Rooms
            </span>
          </button>

          {/* Dating */}
          <button
            aria-label="Dating"
            aria-current={active === "dating" ? "page" : undefined}
            onClick={() => navigate("/dating")}
            className={`inline-flex h-[72px] w-full flex-col items-center justify-center gap-1 transition-all duration-150 ease-out outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0`}
          >
            <span
              className={
                (active === "dating" ? "bg-red-50 px-5 py-1 " : "px-3 py-1 ") +
                "relative inline-flex items-center justify-center rounded-full transition-colors duration-150 ease-out"
              }
            >
              <Heart
                size={24}
                weight={active === "dating" ? "fill" : "regular"}
                className={
                  (active === "dating" ? "text-red-500" : "text-gray-900") +
                  " transition-colors duration-150 ease-out"
                }
              />
            </span>
            <span
              className={
                `text-xs leading-none transition-colors duration-150 ease-out ` +
                (active === "dating"
                  ? "text-red-500 font-bold"
                  : "text-gray-900")
              }
            >
              Dating
            </span>
          </button>

          {/* Direct messages (badge = number of friends with unread) */}
          <button
            aria-label="Direct messages"
            aria-current={active === "direct" ? "page" : undefined}
            onClick={() => navigate("/direct")}
            className={`inline-flex h-[72px] w-full flex-col items-center justify-center gap-1 transition-all duration-150 ease-out outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0`}
          >
            <span
              className={
                (active === "direct" ? "bg-red-50 px-5 py-1 " : "px-3 py-1 ") +
                "relative inline-flex items-center justify-center rounded-full transition-colors duration-150 ease-out"
              }
            >
              <span className="relative inline-flex">
                <ChatCenteredDots
                  size={24}
                  weight={active === "direct" ? "fill" : "regular"}
                  className={
                    (active === "direct" ? "text-red-500" : "text-gray-900") +
                    " transition-colors duration-150 ease-out"
                  }
                />
                {totalDmUnread > 0 && (
                  <span className="absolute -top-1 -right-1 h-4 min-w-[1rem] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center ring-2 ring-white">
                    {totalDmUnread > 99 ? "99+" : totalDmUnread}
                  </span>
                )}
              </span>
            </span>
            <span
              className={
                `text-xs leading-none transition-colors duration-150 ease-out ` +
                (active === "direct"
                  ? "text-red-500 font-bold"
                  : "text-gray-900")
              }
            >
              DM's
            </span>
          </button>

          {/* Inbox: combined unread + unseen likes */}
          <button
            aria-label="Inbox"
            aria-current={active === "inbox" ? "page" : undefined}
            onClick={() => navigate("/inbox")}
            className={`inline-flex h-[72px] w-full flex-col items-center justify-center gap-1 transition-all duration-150 ease-out outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0`}
          >
            <span
              className={
                (active === "inbox" ? "bg-red-50 px-5 py-1 " : "px-3 py-1 ") +
                "relative inline-flex items-center justify-center rounded-full transition-colors duration-150 ease-out"
              }
            >
              <span className="relative inline-flex">
                <BellSimple
                  size={24}
                  weight={active === "inbox" ? "fill" : "regular"}
                  className={
                    (active === "inbox" ? "text-red-500" : "text-gray-900") +
                    " transition-colors duration-150 ease-out"
                  }
                />
                {totalInboxBadge > 0 && (
                  <span className="absolute -top-1 -right-1 h-4 min-w-[1rem] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center ring-2 ring-white">
                    {totalInboxBadge > 99 ? "99+" : totalInboxBadge}
                  </span>
                )}
              </span>
            </span>
            <span
              className={
                `text-xs leading-none transition-colors duration-150 ease-out ` +
                (active === "inbox"
                  ? "text-red-500 font-bold"
                  : "text-gray-900")
              }
            >
              Inbox
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default BottomNav;
