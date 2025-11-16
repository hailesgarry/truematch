import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { ChatBubble, Menu } from "../common/Icons";
import { useNotificationStore } from "../../stores/notificationStore";

interface HeaderProps {
  onAvatarClick: () => void;
  onHeartClick?: () => void;
}

const Header = ({ onAvatarClick, onHeartClick }: HeaderProps) => {
  const unreadByGroup = useNotificationStore((s) => s.unreadByGroup);
  const hasUnseenGroupNotifications = useNotificationStore(
    (s) => s.hasUnseenGroupNotifications
  );
  const location = useLocation();

  const groupUnreadCount = useMemo(() => {
    return Object.entries(unreadByGroup).reduce((sum, [key, value]) => {
      if (key.startsWith("dm:")) return sum;
      return sum + ((value || 0) > 0 ? 1 : 0);
    }, 0);
  }, [unreadByGroup]);

  const onNotificationsRoute = useMemo(() => {
    const path = location.pathname || "";
    return path.startsWith("/inbox");
  }, [location.pathname]);

  const shouldShowBadge =
    !onNotificationsRoute &&
    hasUnseenGroupNotifications &&
    groupUnreadCount > 0;

  return (
    <div className="app-header fixed inset-x-0 top-0 z-20 flex items-center justify-between px-4 h-14 border-b border-gray-100 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      {/* Left: menu trigger */}
      <div className="flex items-center">
        <button
          onClick={onAvatarClick}
          className="inline-flex items-center justify-center focus:outline-none"
          aria-label="Open menu"
        >
          <Menu size={24} className="text-gray-900" />
        </button>
      </div>

      {/* Center: App logo */}
      <div className="flex items-center justify-center absolute left-1/2 -translate-x-1/2">
        <picture>
          {/* Prefer PNG sources for faster paint + crisp rendering; SVG as guaranteed fallback */}
          <source srcSet="/truematch-logomark.png" type="image/png" />
          <img
            src="/truematch-logomark.svg"
            alt="truematch logo"
            className="block h-12 md:h-[50px] w-auto"
            loading="eager"
            height={50}
          />
        </picture>
      </div>

      {/* Right: heart icon */}
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={onHeartClick}
          className="inline-flex items-center justify-center rounded-full focus:outline-none"
          aria-label="Dating"
        >
          <span className="relative inline-flex">
            <ChatBubble size={24} className="text-gray-900" />
            {shouldShowBadge && (
              <span className="absolute -top-1 -right-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white ring-2 ring-white">
                {groupUnreadCount > 99 ? "99+" : groupUnreadCount}
              </span>
            )}
          </span>
        </button>
      </div>
    </div>
  );
};

export default Header;
