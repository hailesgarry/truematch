import React, { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { prefetchDmMessages, preloadRoute } from "../../utils/prefetch";
import type { Message } from "../../types";
import { useMessageStore } from "../../stores/messageStore";
import { usePresenceStore } from "../../stores/presenceStore";
import { useAvatarStore } from "../../stores/avatarStore";
import { useAuthStore } from "../../stores/authStore";
import { useTypingStore } from "../../stores/typingStore";
import TypingIndicator from "../chat/TypingIndicator";
import { Microphone, Image as ImageIcon } from "phosphor-react";

type Props = {
  dmId: string;
  peerUsername: string;
  onClick: () => void;
  unreadCount?: number;
  useLatestPreview?: boolean; // default true
  showBadge?: boolean; // default true (kept for compatibility, not used)
  onLongPress?: () => void; // optional long-press handler (opens actions sheet)
  latestMessage?: Message;
};

const EMPTY_MESSAGES: Message[] = [];

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

type PreviewInfo = {
  text: string;
  voiceNote: boolean;
  mediaType?: "photo" | "video" | "attachment" | "gif";
};

const DirectMessageCard: React.FC<Props> = ({
  dmId,
  peerUsername,
  onClick,
  unreadCount = 0,
  useLatestPreview = true,
  onLongPress,
  latestMessage,
  // showBadge, // intentionally not destructured to avoid unused var
}) => {
  const qc = useQueryClient();
  const messages = useMessageStore(
    (state) => state.messages[dmId] ?? EMPTY_MESSAGES
  );
  const isOnline = usePresenceStore((s) => s.isOnline(peerUsername));
  const storeAvatar = useAvatarStore(
    (s) => s.avatars[(peerUsername || "").toLowerCase()] || null
  );
  const setFromMessage = useAvatarStore((s) => s.setFromMessage);
  const ensureAvatar = useAvatarStore((s) => s.ensure);

  React.useEffect(() => {
    if (peerUsername) ensureAvatar(peerUsername);
  }, [peerUsername, ensureAvatar]);

  const latestFromStore = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if ((m as any)?.deleted || (m as any)?.deletedAt || (m as any)?.system)
        continue;
      return m as Message;
    }
    return undefined;
  }, [messages]);

  const latest = useMemo(() => {
    if (!useLatestPreview) return undefined;
    if (
      latestMessage &&
      !(latestMessage as any)?.deleted &&
      !(latestMessage as any)?.deletedAt &&
      !(latestMessage as any)?.system
    ) {
      return latestMessage;
    }
    return latestFromStore;
  }, [useLatestPreview, latestMessage, latestFromStore]);

  const previewInfo = useMemo<PreviewInfo>(() => {
    const base: PreviewInfo = { text: "", voiceNote: false };
    if (!useLatestPreview) return base;
    if (!latest) return base;
    if ((latest as any).kind === "gif") {
      return { text: "GIF", voiceNote: false, mediaType: "gif" };
    }
    if (isVoiceNoteMessage(latest)) {
      return {
        text: formatVoiceNoteText((latest as any).audio),
        voiceNote: true,
      };
    }
    if ((latest as any).kind === "media" || (latest as any).media) {
      const mediaKind = classifyMediaAttachment((latest as any).media);
      if (mediaKind === "photo") {
        return { text: "Photo", voiceNote: false, mediaType: "photo" };
      }
      if (mediaKind === "video") {
        return { text: "Video", voiceNote: false, mediaType: "video" };
      }
      return { text: "Attachment", voiceNote: false, mediaType: "attachment" };
    }
    return { text: latest.text || "", voiceNote: false };
  }, [latest, useLatestPreview]);

  const timeText =
    useLatestPreview && latest ? formatTimestamp(latest.timestamp) : "";

  // Display author as "You" when the latest message is by the current user
  const selfUsername = useAuthStore((s) => s.username);
  const normalizedPeerName = peerUsername.trim();
  const showTypingIndicator = useTypingStore((s) =>
    s.isTyping(dmId, normalizedPeerName)
  );
  const typingAriaLabel = normalizedPeerName
    ? `${normalizedPeerName} is typing`
    : "Typing";
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
    if (
      latestMessage &&
      (latestMessage.username || "").toLowerCase() === peerLc &&
      latestMessage.avatar
    ) {
      return String(latestMessage.avatar);
    }
    return null as string | null;
  }, [messages, peerUsername, latestMessage]);
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

  const handlePointerEnter = () => {
    // Prefetch the DM thread data and route for faster open
    preloadRoute("/dm/");
    void prefetchDmMessages(qc, dmId);
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
      onMouseEnter={handlePointerEnter}
      onTouchStart={handlePointerEnter}
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
                className="w-full h-full rounded-full object-cover "
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
            {/* Top row: name left, timestamp right */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex-shrink-0 text-gray-900 font-medium truncate">
                  {peerUsername}
                </div>
              </div>
              {timeText ? (
                <span
                  className={[
                    "ml-2 flex-shrink-0 text-[11px]",
                    isUnread ? "text-gray-900 font-semibold" : "text-gray-500",
                  ].join(" ")}
                >
                  {timeText}
                </span>
              ) : null}
            </div>

            {useLatestPreview && latest ? (
              <div className="mt-0.5 flex items-center text-sm text-gray-900 min-w-0">
                <div className="min-w-0 flex items-center flex-1">
                  {showTypingIndicator ? (
                    <TypingIndicator
                      active
                      className="inline-flex items-center text-sm font-medium text-gray-9d00"
                      ariaLabel={typingAriaLabel}
                    />
                  ) : (
                    <>
                      {previewAuthor ? (
                        <>
                          <span className="text-gray-900 font-medium flex-shrink-0 mr-1">
                            {previewAuthor}
                          </span>
                          <span className="text-gray-500 mr-1">:</span>
                        </>
                      ) : null}
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
                    </>
                  )}
                </div>
                {isUnread && (
                  <span
                    className="ml-2 inline-flex items-center justify-center h-4 min-w-[1rem] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex-shrink-0"
                    aria-label={`${unreadCount} unread messages`}
                  >
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </div>
            ) : showTypingIndicator ? (
              <TypingIndicator
                active
                className="mt-0.5 inline-flex items-center text-sm font-medium text-gray-900"
                ariaLabel={typingAriaLabel}
              />
            ) : (
              <span
                className={[
                  "text-sm line-clamp-1",
                  isUnread ? "font-semibold text-gray-900" : "text-gray-500",
                ].join(" ")}
              >
                {previewInfo.voiceNote ? (
                  <span className="flex items-center gap-1">
                    <Microphone
                      size={14}
                      weight="fill"
                      className="flex-shrink-0"
                      aria-hidden="true"
                    />
                    <span className="truncate">{previewInfo.text}</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    {previewInfo.mediaType === "photo" ? (
                      <ImageIcon
                        size={14}
                        weight="fill"
                        className="flex-shrink-0"
                        aria-hidden="true"
                      />
                    ) : null}
                    <span className="truncate">{previewInfo.text}</span>
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
};

export default DirectMessageCard;
