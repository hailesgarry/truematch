import React from "react";
import { Microphone } from "@phosphor-icons/react";
import type { Message } from "../../types";
import { formatDuration } from "../../utils/formatDuration";
import { useAudioDuration } from "../../hooks/useAudioDuration";

export type ReplyInfo = Pick<Message, "username" | "text" | "timestamp"> & {
  messageId?: string;
  kind?: string;
  media?: {
    original?: string;
    gif?: string;
    mp4?: string;
    webm?: string;
    preview?: string;
  };
  audio?: {
    url: string;
    durationMs?: number;
    uploading?: boolean;
  };
  deleted?: boolean;
  deletedAt?: string;
};

export interface ReplyPreviewProps {
  reply: ReplyInfo;
  currentUsername: string | null | undefined;
  fgColorForBubble: string;
  onClick: (reply: {
    messageId?: string;
    username: string;
    timestamp?: string | number | null;
  }) => void;
  isGifUrl: (s: string) => boolean;
  isEmojiOnly: (s?: string) => boolean;
  isVideoUrl: (s: string) => boolean;
  truncate: (s: string, max?: number) => string;
}

const ReplyPreview: React.FC<ReplyPreviewProps> = ({
  reply,
  currentUsername,
  fgColorForBubble,
  onClick,
  isGifUrl,
  isEmojiOnly,
  isVideoUrl,
  truncate,
}) => {
  // Intentionally reference currentUsername to satisfy noUnusedParameters while
  // ensuring we always display the actual username in the UI.
  void currentUsername;
  const replyText = reply.text || "";
  const replyTrimmed = replyText.trim();
  const replyIsGifUrl = isGifUrl(replyTrimmed) && !replyTrimmed.includes(" ");
  const replyIsEmoji = isEmojiOnly(replyText);
  const replyKind = reply.kind;
  const replyStructuredGif =
    replyKind === "gif" && reply.media ? reply.media : null;
  const replyStructuredMedia =
    replyKind === "media" && reply.media ? reply.media : null;
  const replyVoiceNote = replyKind === "audio" || Boolean(reply.audio);
  const replyVoiceDurationMs = useAudioDuration(
    replyVoiceNote ? reply.audio?.url : undefined,
    reply.audio?.durationMs
  );
  const replyIndicatesMedia =
    replyKind === "media" ||
    replyKind === "gif" ||
    Boolean(replyStructuredMedia) ||
    Boolean(replyStructuredGif) ||
    replyIsGifUrl ||
    Boolean(!replyKind && reply.media);
  const emptyText =
    replyTrimmed.length === 0 &&
    !replyStructuredGif &&
    !replyStructuredMedia &&
    !replyIsGifUrl &&
    !replyIsEmoji &&
    !replyVoiceNote;

  const hasMediaPreview = replyIndicatesMedia && !replyVoiceNote;
  const replyDeleted = Boolean(reply.deleted);

  const rootClass = [
    "text-sm mb-1 px-2 py-1 rounded-xl text-gray-600 cursor-pointer focus:outline-none",
    "flex flex-col gap-1",
    hasMediaPreview ? "items-end text-right ml-auto" : "items-start text-left",
  ].join(" ");

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onClick({
          messageId: (reply as any).messageId,
          username: reply.username,
          timestamp: (reply as any).timestamp ?? null,
        });
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onClick({
            messageId: (reply as any).messageId,
            username: reply.username,
            timestamp: (reply as any).timestamp ?? null,
          });
        }
      }}
      className={rootClass}
      style={{
        background: fgColorForBubble === "#ffffff" ? "#f8fafc" : "#e2e8f0",
        border: "1px solid #cbd5f5",
      }}
    >
      <div className="text-sm font-semibold text-gray-800 leading-tight">
        {reply.username}
      </div>
      <div>
        {(() => {
          if (replyStructuredMedia) {
            const media = replyStructuredMedia;
            const previewSrc =
              media.preview || media.gif || media.original || "";
            const origin = media.original || "";
            const isVid = Boolean(origin) && isVideoUrl(origin);
            return (
              <span className="relative inline-block max-w-[60px] max-h-[60px] overflow-hidden">
                {isVid && origin ? (
                  <video
                    className="rounded-md shadow-sm object-contain max-w-[60px] max-h-[60px]"
                    src={origin}
                    muted
                    playsInline
                    loop
                    preload="metadata"
                    poster={previewSrc || undefined}
                  />
                ) : (
                  <img
                    src={previewSrc || origin}
                    alt="media preview"
                    className="rounded-md shadow-sm object-contain max-w-[60px] max-h-[60px]"
                    loading="lazy"
                    draggable={false}
                  />
                )}
                {replyDeleted ? (
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md bg-black/55 text-[10px] font-semibold uppercase tracking-wide text-white shadow-inner backdrop-blur-[4px]"></span>
                ) : null}
              </span>
            );
          }

          if (replyVoiceNote) {
            const durationLabel = formatDuration(replyVoiceDurationMs);
            const durationText = ` (${durationLabel})`;
            return (
              <span className="flex items-center gap-1 text-gray-500">
                <Microphone size={16} weight="fill" />
                <span>{`Voice note${durationText}`}</span>
              </span>
            );
          }

          if (replyStructuredGif) {
            const media = replyStructuredGif;
            const still =
              media.preview || media.gif || media.original || replyText;
            return (
              <span className="inline-block max-w-[60px] max-h-[60px]">
                <img
                  src={still}
                  alt="gif preview"
                  className="rounded-md shadow-sm object-contain max-w-[60px] max-h-[60px]"
                  loading="lazy"
                  draggable={false}
                />
              </span>
            );
          }

          if (replyIsGifUrl) {
            return (
              <span className="inline-block max-w-[60px] max-h-[60px]">
                <img
                  src={replyTrimmed}
                  alt="gif preview"
                  className="rounded-md shadow-sm object-contain max-w-[60px] max-h-[60px]"
                  loading="lazy"
                  draggable={false}
                />
              </span>
            );
          }

          if (replyIsEmoji) {
            return <span className="text-2xl">{replyText}</span>;
          }

          // Fallback: if no previewable content, show a subtle placeholder
          if (emptyText) {
            return null;
          }
          return <span>{truncate(replyText, 60)}</span>;
        })()}
      </div>
    </div>
  );
};

export default ReplyPreview;
