import React, { useMemo } from "react";
import type { Group } from "../../types";
import { useMessageStore } from "../../stores/messageStore";
import { ArrowRight, Microphone, Image as ImageIcon } from "phosphor-react";
import GroupMembersPreview from "./GroupMembersPreview";

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
  membersLoading?: boolean; // show skeletons in avatar stack
  joined?: boolean; // ← new
  borderless?: boolean; // ← NEW: hide the outer border
  nameClassName?: string; // ← NEW: override group name typography
  marginless?: boolean; // ← NEW: remove bottom margin (mb-3)
  onMouseEnter?: () => void; // for route/data prefetch on hover
  hideGroupAvatar?: boolean; // ← NEW: suppress avatar (notification view)
  hideMembersSection?: boolean; // ← NEW: suppress member avatars + CTA
  innerPaddingClassName?: string; // ← NEW: override default inner padding
  onPressStart?: () => void; // ← NEW: pointer/key press start callback
};

// Simple timestamp formatter: "h:mm AM" if today, otherwise "MMM d"
function formatTimestamp(ts?: string | number | Date | null) {
  if (ts == null) return "";
  let d: Date;
  if (ts instanceof Date) {
    d = ts;
  } else if (typeof ts === "number") {
    d = new Date(ts);
  } else {
    const parsed = Date.parse(ts);
    if (!Number.isFinite(parsed)) return "";
    d = new Date(parsed);
  }
  if (!Number.isFinite(d.getTime())) return "";
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

const IMAGE_URL_REGEX = /\.(png|jpe?g|webp|avif|heic|heif|bmp)(\?|#|$)/i;
const VIDEO_URL_REGEX = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;

function looksLikeImageUrl(url?: string | null): boolean {
  if (!url || typeof url !== "string") return false;
  if (url.startsWith("data:image/")) return true;
  if (/\/image\/upload\//i.test(url)) return true;
  return IMAGE_URL_REGEX.test(url);
}

function looksLikeVideoUrl(url?: string | null): boolean {
  if (!url || typeof url !== "string") return false;
  if (url.startsWith("data:video/")) return true;
  if (/\/video\/upload\//i.test(url)) return true;
  return VIDEO_URL_REGEX.test(url);
}

function classifyMediaAttachment(media: any): "photo" | "video" | null {
  if (!media || typeof media !== "object") return null;
  const candidates = [
    media.original,
    media.preview,
    media.placeholder,
    media.mp4,
    media.webm,
    media.gif,
  ].filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );

  if (candidates.some((value) => looksLikeVideoUrl(value))) return "video";
  if (candidates.some((value) => looksLikeImageUrl(value))) return "photo";
  return null;
}

function isVoiceNoteMessage(message: any): boolean {
  if (!message) return false;
  if (message.kind === "audio") return true;
  return !!message.audio && typeof message.audio === "object";
}

function formatVoiceNoteText(audio: any): string {
  const durationMs = Number(audio?.durationMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "Voice note";
  }
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const formatted = `${minutes}:${seconds.toString().padStart(2, "0")}`;
  return `Voice note (${formatted})`;
}

// Robust system message detection (align with ChatPage)
function isSystemMessage(m: any): boolean {
  if (!m) return false;
  if (m.system === true) return true;
  if (typeof m.systemType === "string" && m.systemType.length > 0) return true;
  const u = typeof m.username === "string" ? m.username.toLowerCase() : "";
  return u === "system" || u === "_system";
}

type PreviewState = {
  text: string;
  voiceNote: boolean;
  username?: string;
  timestamp?: string | number | Date | null;
  source: "store" | "summary" | "description";
  mediaType?: "photo" | "video" | "attachment" | "gif";
};

const GroupCardComponent: React.FC<Props> = ({
  group,
  onClick,
  unreadCount = 0,
  useLatestPreview = true,
  // showBadge, // intentionally not destructured to avoid unused var
  membersAvatars,
  membersTotal,
  membersLoading = false,
  joined = false,
  borderless = false, // ← NEW default
  nameClassName, // ← NEW
  marginless = false, // ← NEW default
  onMouseEnter,
  hideGroupAvatar = false,
  hideMembersSection = false,
  innerPaddingClassName,
  onPressStart,
}) => {
  // const messages = useMessageStore((s) => s.messages[group.id] || []);
  const messages = useMessageStore(
    (s) => s.messages[group.id] ?? EMPTY_MESSAGES
  );

  const latest = useMemo(() => {
    if (!useLatestPreview) return undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.deleted || (m as any)?.deletedAt || isSystemMessage(m)) continue;
      return m;
    }
    return undefined;
  }, [messages, useLatestPreview]);

  const previewInfo = useMemo<PreviewState>(() => {
    const fallback: PreviewState = {
      text: group.description,
      voiceNote: false,
      source: "description",
    };
    if (!useLatestPreview) return fallback;

    if (latest) {
      let text = group.description;
      let voiceNote = false;
      let mediaType: PreviewState["mediaType"];

      if ((latest as any).kind === "gif") {
        text = "GIF";
        mediaType = "gif";
      } else if (isVoiceNoteMessage(latest)) {
        voiceNote = true;
        text = formatVoiceNoteText((latest as any).audio);
      } else if ((latest as any).kind === "media" || (latest as any).media) {
        const mediaKind = classifyMediaAttachment((latest as any).media);
        if (mediaKind === "photo") {
          text = "Photo";
          mediaType = "photo";
        } else if (mediaKind === "video") {
          text = "Video";
          mediaType = "video";
        } else {
          text = "Attachment";
          mediaType = "attachment";
        }
      } else {
        const candidate = (latest.text || "").trim();
        if (candidate && !candidate.includes(" ") && isGifUrl(candidate)) {
          text = "GIF";
          mediaType = "gif";
        } else {
          text = candidate || group.description;
        }
      }

      return {
        text,
        voiceNote,
        username: latest.username,
        timestamp: latest.timestamp,
        source: "store",
        mediaType,
      };
    }

    const summary = group.lastMessagePreview;
    if (summary) {
      let text =
        typeof summary.previewText === "string" && summary.previewText
          ? summary.previewText
          : typeof summary.text === "string" && summary.text
          ? summary.text
          : group.description;
      let voiceNote = Boolean(summary.voiceNote);
      let mediaType: PreviewState["mediaType"];
      if (summary.hasMedia) {
        if (summary.mediaType === "photo") {
          text = "Photo";
          mediaType = "photo";
        } else if (summary.mediaType === "video") {
          text = "Video";
          mediaType = "video";
        } else {
          text = "Attachment";
          mediaType = "attachment";
        }
      }
      if (voiceNote) {
        text = summary.audioDurationMs
          ? formatVoiceNoteText({ durationMs: summary.audioDurationMs })
          : "Voice note";
      }

      return {
        text,
        voiceNote,
        username:
          typeof summary.username === "string" ? summary.username : undefined,
        timestamp:
          summary.createdAt ??
          group.lastMessageAt ??
          group.lastActiveAt ??
          null,
        source: "summary",
        mediaType,
      };
    }

    return fallback;
  }, [
    latest,
    useLatestPreview,
    group.description,
    group.lastMessagePreview,
    group.lastMessageAt,
    group.lastActiveAt,
  ]);

  const hasMemberSection =
    membersAvatars !== undefined || typeof membersTotal === "number";
  const groupAvatar = group.avatarUrl || group.thumbnail || null;
  const showStructuredPreview = previewInfo.source !== "description";
  const shouldShowAvatar = !hideGroupAvatar;
  const shouldShowMemberSection = !hideMembersSection && hasMemberSection;

  const timeText = formatTimestamp(previewInfo.timestamp);

  const isUnread = unreadCount > 0;
  const unreadBadge = !isUnread ? null : (
    <span
      className="flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white flex-shrink-0"
      aria-label={`${unreadCount} unread messages`}
    >
      {unreadCount > 99 ? "99+" : unreadCount}
    </span>
  );
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
      onMouseEnter={onMouseEnter}
      onPointerDown={() => {
        if (onPressStart) onPressStart();
      }}
      onKeyDown={(event) => {
        if (!onPressStart) return;
        if (event.key === "Enter" || event.key === " ") {
          onPressStart();
        }
      }}
    >
      <div
        className={[
          "relative flex flex-col",
          innerPaddingClassName ?? "p-4",
        ].join(" ")}
      >
        {/* Top row: thumbnail + name + unread badge on right */}
        <div className="flex items-center gap-3">
          {/* Avatar */}
          {shouldShowAvatar ? (
            groupAvatar ? (
              <img
                src={groupAvatar}
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
            )
          ) : null}

          <div className="flex-1 min-w-0">
            {/* Header row: name left, time right */}
            <div className="flex items-baseline justify-between gap-2">
              <span
                className={[
                  nameClassName ?? "text-message",
                  "font-semibold text-gray-900 block truncate leading-tight tracking-[-0.01em]",
                ].join(" ")}
              >
                {group.name}
              </span>

              {timeText ? (
                <span className={timeClassName}>{timeText}</span>
              ) : null}
            </div>

            {/* Subtitle: sender : preview  |  badge */}
            {showStructuredPreview ? (
              <div className="mt-2 flex min-w-0 items-start justify-between gap-2 text-sm text-gray-900">
                <div className="min-w-0 flex items-center flex-1">
                  {previewInfo.voiceNote ? (
                    <span
                      className={`flex items-center gap-1 min-w-0 ${
                        isUnread
                          ? "font-semibold text-gray-900"
                          : "text-gray-500"
                      }`}
                    >
                      <Microphone
                        size={14}
                        weight="fill"
                        className="flex-shrink-0"
                        aria-hidden="true"
                      />
                      <span className="truncate">{previewInfo.text}</span>
                    </span>
                  ) : (
                    <span
                      className={[
                        "flex items-center gap-1 min-w-0",
                        isUnread
                          ? "font-semibold text-gray-900"
                          : "text-gray-500",
                      ].join(" ")}
                    >
                      {previewInfo.mediaType === "photo" ? (
                        <ImageIcon
                          size={14}
                          className="flex-shrink-0"
                          aria-hidden="true"
                        />
                      ) : null}
                      <span className="truncate">{previewInfo.text}</span>
                    </span>
                  )}
                </div>
                {unreadBadge}
              </div>
            ) : (
              <div className="mt-2 flex min-w-0 items-start justify-between gap-2 text-sm">
                <span
                  className={[
                    "flex min-w-0 items-center gap-1",
                    isUnread ? "font-semibold text-gray-900" : "text-gray-900",
                  ].join(" ")}
                >
                  {previewInfo.voiceNote ? (
                    <Microphone
                      size={14}
                      weight="fill"
                      className="flex-shrink-0"
                      aria-hidden="true"
                    />
                  ) : previewInfo.mediaType === "photo" ? (
                    <ImageIcon
                      size={14}
                      weight="fill"
                      className="flex-shrink-0"
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className="truncate">{previewInfo.text}</span>
                </span>
                {unreadBadge}
              </div>
            )}
          </div>
        </div>

        {/* Bottom row: members stack + status */}
        {shouldShowMemberSection && (
          <div className="mt-4 flex items-center justify-between">
            <div className="flex items-center">
              <GroupMembersPreview
                avatars={membersAvatars}
                total={membersTotal}
                loading={membersLoading}
              />
            </div>
            {joined ? (
              <span className="inline-flex h-7 items-center justify-center gap-1 rounded-full bg-primary-gradient text-white px-3 text-xs font-semibold select-none">
                Joined
              </span>
            ) : (
              <span className="inline-flex h-7 items-center justify-center gap-1 rounded-full bg-primary-gradient text-white px-3 text-xs font-semibold select-none">
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

const GroupCard = React.memo(GroupCardComponent, (prev, next) => {
  return (
    prev.group.id === next.group.id &&
    prev.group.name === next.group.name &&
    prev.group.avatarUrl === next.group.avatarUrl &&
    prev.group.thumbnail === next.group.thumbnail &&
    prev.unreadCount === next.unreadCount &&
    prev.useLatestPreview === next.useLatestPreview &&
    prev.joined === next.joined &&
    // Shallow compare avatars array reference and content length
    (prev.membersAvatars === next.membersAvatars ||
      (Array.isArray(prev.membersAvatars) &&
        Array.isArray(next.membersAvatars) &&
        prev.membersAvatars.length === next.membersAvatars.length &&
        prev.membersAvatars.every((v, i) => v === next.membersAvatars![i]))) &&
    prev.membersTotal === next.membersTotal &&
    prev.borderless === next.borderless &&
    prev.nameClassName === next.nameClassName &&
    prev.marginless === next.marginless &&
    prev.hideGroupAvatar === next.hideGroupAvatar &&
    prev.hideMembersSection === next.hideMembersSection &&
    prev.innerPaddingClassName === next.innerPaddingClassName &&
    prev.onPressStart === next.onPressStart
  );
});

export default GroupCard;
