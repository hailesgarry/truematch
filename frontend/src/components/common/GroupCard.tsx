import React, { useMemo } from "react";
import type { Group } from "../../types";
import { useMessageStore } from "../../stores/messageStore";
import AvatarStack from "./AvatarStack";
import { ArrowRight } from "phosphor-react";

// ADD THIS: stable empty array to avoid new [] each render (Opera Mini fix)
const EMPTY_MESSAGES: any[] = [];

type Props = {
  group: Group;
  onClick: () => void;
  unreadCount?: number;
  useLatestPreview?: boolean; // default true
  showBadge?: boolean; // default true (kept for compatibility, not used)
  membersAvatars?: (string | null | undefined)[];
  membersTotal?: number;
  joined?: boolean; // ← new
  borderless?: boolean; // ← NEW: hide the outer border
  nameClassName?: string; // ← NEW: override group name typography
  marginless?: boolean; // ← NEW: remove bottom margin (mb-3)
};

// Simple timestamp formatter: "h:mm AM" if today, otherwise "MMM d"
function formatTimestamp(ts?: string) {
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

// Add helpers to detect single GIF URLs in text previews
const GIF_SINGLE_REGEX = /\.(gif)(\?|#|$)/i;
function isGifUrl(str: string): boolean {
  if (!/^https?:\/\//i.test(str)) return false;
  return (
    GIF_SINGLE_REGEX.test(str) ||
    /tenor\.com\/.*\.gif/i.test(str) ||
    /media\.giphy\.com\/media\//i.test(str)
  );
}

const GroupCard: React.FC<Props> = ({
  group,
  onClick,
  unreadCount = 0,
  useLatestPreview = true,
  // showBadge, // intentionally not destructured to avoid unused var
  membersAvatars,
  membersTotal,
  joined = false,
  borderless = false, // ← NEW default
  nameClassName, // ← NEW
  marginless = false, // ← NEW default
}) => {
  // const messages = useMessageStore((s) => s.messages[group.id] || []);
  const messages = useMessageStore(
    (s) => s.messages[group.id] ?? EMPTY_MESSAGES
  );

  const latest = useMemo(() => {
    if (!useLatestPreview) return undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.deleted || m?.system) continue;
      return m;
    }
    return undefined;
  }, [messages, useLatestPreview]);

  const preview = useMemo(() => {
    if (!useLatestPreview) return group.description;
    if (!latest) return group.description;

    if ((latest as any).kind === "gif") return "GIF";
    if ((latest as any).kind === "media") return "Attachment";

    const text = (latest.text || "").trim();
    if (text && !text.includes(" ") && isGifUrl(text)) {
      return "GIF";
    }
    return latest.text || group.description;
  }, [latest, group.description, useLatestPreview]);

  const hasMemberSection =
    membersAvatars !== undefined || typeof membersTotal === "number";
  const hasAvatars = !!membersAvatars && membersAvatars.length > 0;

  const timeText =
    useLatestPreview && latest ? formatTimestamp(latest.timestamp) : "";

  const isUnread = unreadCount > 0;
  const timeClassName = [
    "ml-2 flex-shrink-0 text-[11px]",
    isUnread ? "text-gray-900 font-semibold" : "text-gray-500",
  ].join(" ");

  return (
    <button
      className={[
        "w-full rounded-2xl bg-white text-left focus:outline-none focus-visible:outline-2 focus-visible:outline-gray-300",
        marginless ? "" : "mb-3",
        borderless ? "" : "border border-gray-100",
      ].join(" ")}
      onClick={onClick}
    >
      <div className="relative flex flex-col p-4 sm:p-5">
        {/* Top row: thumbnail + name + unread badge on right */}
        <div className="flex items-start gap-3">
          {/* Avatar */}
          {group.avatarUrl ? (
            <img
              src={group.avatarUrl}
              alt={`${group.name} avatar`}
              className="w-12 h-12 rounded-[14px] flex-shrink-0 object-cover"
            />
          ) : (
            <div className="w-12 h-12 rounded-[14px] bg-sky-300 flex items-center justify-center text-white font-bold text-lg">
              {group.name
                .split(" ")
                .map((w) => w[0])
                .join("")
                .toUpperCase()
                .slice(0, 2)}
            </div>
          )}

          <div className="flex-1 min-w-0">
            {/* Header row: name left, unread badge right */}
            <div className="flex items-baseline justify-between gap-2">
              <span
                className={[
                  nameClassName ?? "text-message",
                  "font-semibold text-gray-900 block truncate leading-tight tracking-[-0.01em]",
                ].join(" ")}
              >
                {group.name}
              </span>

              {isUnread && (
                <span
                  className="inline-flex items-center justify-center h-4 min-w-[1rem] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold"
                  aria-label={`${unreadCount} unread messages`}
                >
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </div>

            {/* Subtitle: sender : preview  |  time */}
            {useLatestPreview && latest ? (
              <div className="mt-2 flex items-center text-xs text-gray-900 min-w-0">
                <div className="min-w-0 flex items-center flex-1">
                  <span className="text-gray-900 font-medium flex-shrink-0">
                    {latest.username}
                  </span>
                  <span className="mx-1 text-gray-400">:</span>
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
                  <span className={timeClassName}>{timeText}</span>
                ) : null}
              </div>
            ) : (
              <div
                className={[
                  "mt-2 text-xs line-clamp-1",
                  isUnread ? "font-semibold text-gray-900" : "text-gray-900",
                ].join(" ")}
              >
                {preview}
              </div>
            )}
          </div>
        </div>

        {/* Bottom row: members stack + status */}
        {hasMemberSection && (
          <div className="mt-4 flex items-center justify-between">
            <div className="flex items-center">
              {hasAvatars ? (
                <AvatarStack avatars={membersAvatars!} total={membersTotal} />
              ) : (
                <span className="text-[10px] text-gray-400 select-none" />
              )}
            </div>
            {joined ? (
              <span className="inline-flex h-7 items-center justify-center gap-1 rounded-full bg-[#FD1D1D] text-white px-3 text-xs font-semibold select-none">
                Joined
              </span>
            ) : (
              <span className="inline-flex h-7 items-center justify-center gap-1 rounded-full bg-[#FD1D1D] text-white px-3 text-xs font-semibold select-none">
                <span className="leading-none">Join room</span>
                <ArrowRight
                  size={12}
                  weight="bold"
                  className="translate-y-[0.5px]"
                />
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
};

export default GroupCard;
