import React, { useMemo } from "react";
import type { Message } from "../../types";
import { useMessageStore } from "../../stores/messageStore";
import { usePresenceStore } from "../../stores/presenceStore";
import { useAvatarStore } from "../../stores/avatarStore";
import { useAuthStore } from "../../stores/authStore";

type Props = {
  dmId: string;
  peerUsername: string;
  onClick: () => void;
  unreadCount?: number;
  useLatestPreview?: boolean; // default true
  showBadge?: boolean; // default true (kept for compatibility, not used)
  onLongPress?: () => void; // optional long-press handler (opens actions sheet)
};

// "h:mm AM" if today, else "MMM d"
function formatTimestamp(ts?: number | string) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  if (sameDay) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(d);
}

const DirectMessageCard: React.FC<Props> = ({
  dmId,
  peerUsername,
  onClick,
  unreadCount = 0,
  useLatestPreview = true,
  onLongPress,
  // showBadge, // intentionally not destructured to avoid unused var
}) => {
  const messages = useMessageStore((s) => s.messages[dmId] || []);
  const isOnline = usePresenceStore((s) => s.isOnline(peerUsername));
  const storeAvatar = useAvatarStore((s) => s.getAvatar(peerUsername) || null);
  const setFromMessage = useAvatarStore((s) => s.setFromMessage);
  const ensureAvatar = useAvatarStore((s) => s.ensure);

  React.useEffect(() => {
    if (peerUsername) ensureAvatar(peerUsername);
  }, [peerUsername, ensureAvatar]);

  const latest = useMemo(() => {
    if (!useLatestPreview) return undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if ((m as any)?.deleted || (m as any)?.system) continue;
      return m as Message;
    }
    return undefined;
  }, [messages, useLatestPreview]);

  const preview = useMemo(() => {
    if (!useLatestPreview) return "";
    if (!latest) return "";
    if ((latest as any).kind === "gif") return "GIF";
    if ((latest as any).kind === "media") return "Attachment";
    return latest.text || "";
  }, [latest, useLatestPreview]);

  const timeText =
    useLatestPreview && latest ? formatTimestamp(latest.timestamp) : "";

  // Display author as "You" when the latest message is by the current user
  const selfUsername = useAuthStore((s) => s.username);
  const previewAuthor = useMemo(() => {
    if (!latest) return "";
    const a = String((latest as any)?.username || "");
    const me = String(selfUsername || "");
    if (a && me && a.toLowerCase() === me.toLowerCase()) return "You";
    return a || "";
  }, [latest, selfUsername]);

  const peerInitials =
    (peerUsername || "?")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?";

  const derivedAvatar = useMemo(() => {
    const peerLc = (peerUsername || "").toLowerCase();
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i] as any;
      if ((m?.username || "").toLowerCase() === peerLc && m?.avatar) {
        return String(m.avatar);
      }
    }
    return null as string | null;
  }, [messages, peerUsername]);
  React.useEffect(() => {
    if (!storeAvatar && derivedAvatar) {
      setFromMessage(peerUsername, derivedAvatar);
    }
  }, [storeAvatar, derivedAvatar, peerUsername, setFromMessage]);
  const avatarToUse = storeAvatar || derivedAvatar;

  const isUnread = unreadCount > 0;

  // Long-press handling (pointer + context menu)
  const longPressTimeout = React.useRef<number | null>(null);
  const longPressed = React.useRef(false);
  const startPos = React.useRef<{ x: number; y: number } | null>(null);
  const PRESS_MS = 550; // standard mobile long-press duration
  const MOVE_TOLERANCE = 10; // px

  const clearTimer = () => {
    if (longPressTimeout.current != null) {
      window.clearTimeout(longPressTimeout.current);
      longPressTimeout.current = null;
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!onLongPress) return; // no-op if not provided
    longPressed.current = false;
    startPos.current = { x: e.clientX, y: e.clientY };
    clearTimer();
    longPressTimeout.current = window.setTimeout(() => {
      longPressed.current = true;
      try {
        // Subtle haptic on supported devices
        (navigator as any).vibrate?.(10);
      } catch {}
      onLongPress?.();
    }, PRESS_MS);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!onLongPress || !startPos.current) return;
    const dx = Math.abs(e.clientX - startPos.current.x);
    const dy = Math.abs(e.clientY - startPos.current.y);
    if (dx > MOVE_TOLERANCE || dy > MOVE_TOLERANCE) {
      clearTimer();
    }
  };

  const handlePointerUpOrCancel = () => {
    if (!onLongPress) return;
    clearTimer();
    // click handling is managed in onClick below using longPressed flag
  };

  const handleClick = (e: React.MouseEvent) => {
    // If a long-press just fired, consume this click to avoid navigation
    if (longPressed.current) {
      e.preventDefault();
      e.stopPropagation();
      longPressed.current = false; // reset
      return;
    }
    onClick();
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!onLongPress) return;
    // Desktop right-click -> treat as long-press
    e.preventDefault();
    e.stopPropagation();
    onLongPress();
  };

  return (
    <button
      className="w-full mb-2 rounded-2xl bg-white text-left"
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUpOrCancel}
      onPointerCancel={handlePointerUpOrCancel}
    >
      <div className="relative flex flex-col">
        <div className="flex items-start">
          {/* Avatar thumbnail with corner status dot */}
          <div className="relative w-12 h-12 flex-shrink-0">
            {avatarToUse ? (
              <img
                src={avatarToUse}
                alt={`${peerUsername} avatar`}
                className="w-full h-full rounded-full object-cover border border-gray-200"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-full h-full rounded-full bg-sky-300 flex items-center justify-center text-white font-bold text-lg">
                {peerInitials}
              </div>
            )}
            {isOnline && (
              <span
                className="absolute -bottom-0.5 right-0.5 w-3 h-3 rounded-full ring-2 ring-white bg-green-500"
                title="Online"
                aria-label="Online"
                role="status"
              />
            )}
          </div>

          <div className="ml-3 flex-1 min-w-0">
            {/* Top row: name left, unread badge right */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex-shrink-0 text-gray-900 font-medium truncate">
                  {peerUsername}
                </div>
              </div>
              {isUnread && (
                <span
                  className="inline-flex items-center justify-center h-4 min-w-[1rem] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold"
                  aria-label={`${unreadCount} unread messages`}
                >
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </div>

            {useLatestPreview && latest ? (
              <div className="mt-0.5 flex items-center text-xs text-gray-900 min-w-0">
                <div className="min-w-0 flex items-center flex-1">
                  <span className="text-gray-900 font-medium flex-shrink-0 mr-1">
                    {previewAuthor}
                  </span>
                  <span className="text-gray-400 mr-1">:</span>
                  <span
                    className={[
                      "truncate",
                      isUnread
                        ? "font-semibold text-gray-900"
                        : "text-gray-500",
                    ].join(" ")}
                  >
                    {preview}
                  </span>
                </div>
                {timeText ? (
                  <span
                    className={[
                      "ml-2 flex-shrink-0 text-[11px]",
                      isUnread
                        ? "text-gray-900 font-semibold"
                        : "text-gray-500",
                    ].join(" ")}
                  >
                    {timeText}
                  </span>
                ) : null}
              </div>
            ) : (
              <span
                className={[
                  "text-xs line-clamp-1",
                  isUnread ? "font-semibold text-gray-900" : "text-gray-500",
                ].join(" ")}
              >
                {preview}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
};

export default DirectMessageCard;
