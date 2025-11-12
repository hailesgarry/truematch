import React from "react";
import { Microphone } from "@phosphor-icons/react";
import { formatDuration } from "../../utils/formatDuration";
import { useAudioDuration } from "../../hooks/useAudioDuration";

type AnimatedSources = {
  mp4?: string;
  webm?: string;
  gif?: string;
  preview?: string;
};

export interface ReplyLike {
  username: string;
  text?: string;
  kind?: "gif" | "media" | "audio" | string;
  media?: {
    original?: string;
    preview?: string;
    mp4?: string;
    webm?: string;
    gif?: string;
  };
  audio?: {
    url: string;
    durationMs?: number;
    uploading?: boolean;
  };
}

export interface EditLike {
  text?: string;
  kind?: "gif" | "media" | "audio" | string;
  media?: {
    original?: string;
    preview?: string;
    mp4?: string;
    webm?: string;
    gif?: string;
  };
  audio?: {
    url: string;
    durationMs?: number;
    uploading?: boolean;
  };
}

interface ComposerPreviewBaseProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

const ComposerPreviewBase: React.FC<ComposerPreviewBaseProps> = ({
  title,
  onClose,
  children,
}) => {
  return (
    <div className="mb-3 px-3 py-2 rounded-md bg-gray-100 relative flex flex-col gap-1">
      <div className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">
        {title}
      </div>
      <div className="text-sm text-gray-700 break-words flex items-center gap-2 min-w-0">
        {children}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="absolute top-1.5 right-1.5 text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring focus-visible:ring-blue-500 rounded"
        aria-label="Close"
        title="Close"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
};

interface ComposerPreviewContentProps {
  // exactly one of these should be provided
  edit?: EditLike; // editing preview based on original message
  reply?: ReplyLike | null; // reply preview
  AnimatedMedia: React.FC<{
    url: string;
    mediaSources?: AnimatedSources;
  }>;
  isGifUrl: (s: string) => boolean;
  isEmojiOnly: (s?: string) => boolean;
  isVideoUrl: (s: string) => boolean;
}

const ComposerPreviewContent: React.FC<ComposerPreviewContentProps> = ({
  edit,
  reply,
  AnimatedMedia,
  isGifUrl,
  isEmojiOnly,
  isVideoUrl,
}) => {
  const editHasVoiceNote = Boolean(
    edit && (edit.kind === "audio" || edit.audio)
  );
  const replyHasVoiceNote = Boolean(
    reply && (reply.kind === "audio" || reply.audio)
  );

  const editVoiceDurationMs = useAudioDuration(
    editHasVoiceNote ? edit?.audio?.url : undefined,
    edit?.audio?.durationMs
  );
  const replyVoiceDurationMs = useAudioDuration(
    replyHasVoiceNote ? reply?.audio?.url : undefined,
    reply?.audio?.durationMs
  );

  // Editing preview
  if (edit && !reply) {
    const t = edit.text || "";
    const trimmed = t.trim();
    if (editHasVoiceNote) {
      const durationLabel = formatDuration(editVoiceDurationMs);
      const durationText = ` (${durationLabel})`;
      return (
        <span className="flex items-center gap-2 text-gray-600">
          <Microphone size={16} weight="fill" />
          <span className="truncate">{`Voice note${durationText}`}</span>
        </span>
      );
    }

    // Show structured media
    if (edit.kind === "media" && edit.media) {
      const media = edit.media;
      const src = media.preview || media.original || "";
      const isVid = isVideoUrl(media.original || "");
      return (
        <span className="inline-block max-w-[60px] max-h-[60px]">
          {isVid ? (
            <video
              className="rounded-md shadow-sm object-contain max-w-[60px] max-h-[60px]"
              src={media.original}
              muted
              playsInline
              loop
              preload="metadata"
            />
          ) : (
            <img
              src={src}
              alt="media preview"
              className="rounded-md shadow-sm object-contain max-w-[60px] max-h-[60px]"
              loading="lazy"
              draggable={false}
            />
          )}
        </span>
      );
    }

    // Structured GIF
    if (edit.kind === "gif" && edit.media) {
      const media = edit.media;
      const origin = media.original || media.gif || trimmed || "";
      return (
        <span className="inline-block max-w-[60px] max-h-[60px]">
          <AnimatedMedia
            url={origin}
            mediaSources={{
              mp4: media.mp4,
              webm: media.webm,
              gif: media.gif || origin,
            }}
          />
        </span>
      );
    }

    // Single GIF URL in text
    const singleGifUrl = trimmed && isGifUrl(trimmed) && !trimmed.includes(" ");
    if (singleGifUrl) {
      return (
        <span className="inline-block max-w-[60px] max-h-[60px]">
          <AnimatedMedia url={trimmed} />
        </span>
      );
    }
    // Emoji only
    if (isEmojiOnly(t)) {
      return <span className="text-2xl">{t}</span>;
    }
    // Fallback to text
    return (
      <span className="flex-1 min-w-0 overflow-hidden line-clamp-2">{t}</span>
    );
  }

  // Reply preview
  if (reply) {
    const replyText = reply.text || "";
    const replyTrimmed = replyText.trim();
    const replyIsGifUrl = isGifUrl(replyTrimmed) && !replyTrimmed.includes(" ");
    const replyIsEmoji = isEmojiOnly(replyText);
    const replyStructuredGif = reply.kind === "gif" && reply.media;
    const replyStructuredMedia = reply.kind === "media" && reply.media;
    const replyVoiceNote = replyHasVoiceNote;

    if (replyStructuredMedia) {
      const media = reply.media!;
      const src = media.preview || media.original || "";
      const isVid = isVideoUrl(media.original || "");
      return (
        <span className="inline-block max-w-[60px] max-h-[60px]">
          {isVid ? (
            <video
              className="rounded-md shadow-sm object-contain max-w-[60px] max-h-[60px]"
              src={media.original}
              muted
              playsInline
              loop
              preload="metadata"
            />
          ) : (
            <img
              src={src}
              alt="media preview"
              className="rounded-md shadow-sm object-contain max-w-[60px] max-h-[60px]"
              loading="lazy"
              draggable={false}
            />
          )}
        </span>
      );
    }

    if (replyVoiceNote) {
      const durationLabel = formatDuration(replyVoiceDurationMs);
      const durationText = ` (${durationLabel})`;
      return (
        <span className="flex items-center gap-2 text-gray-600">
          <Microphone size={16} weight="fill" />
          <span className="truncate">{`Voice note${durationText}`}</span>
        </span>
      );
    }

    if (replyStructuredGif) {
      const media = reply.media!;
      const origin = media.original || media.gif || replyText;
      return (
        <span className="inline-block max-w-[60px] max-h-[60px]">
          <AnimatedMedia
            url={origin}
            mediaSources={{
              mp4: media.mp4,
              webm: media.webm,
              gif: media.gif || origin,
            }}
          />
        </span>
      );
    }

    if (replyIsGifUrl) {
      return (
        <span className="inline-block max-w-[60px] max-h-[60px]">
          <AnimatedMedia url={replyTrimmed} />
        </span>
      );
    }
    if (replyIsEmoji) {
      return <span className="text-2xl">{replyText}</span>;
    }
    return (
      <span className="flex-1 min-w-0 overflow-hidden line-clamp-2">
        {replyText}
      </span>
    );
  }

  return null;
};

interface EditingPreviewProps {
  message: EditLike;
  onClose: () => void;
  AnimatedMedia: ComposerPreviewContentProps["AnimatedMedia"];
  isGifUrl: (s: string) => boolean;
  isEmojiOnly: (s?: string) => boolean;
  isVideoUrl: (s: string) => boolean;
}

export const EditingPreview: React.FC<EditingPreviewProps> = ({
  message,
  onClose,
  AnimatedMedia,
  isGifUrl,
  isEmojiOnly,
  isVideoUrl,
}) => {
  return (
    <ComposerPreviewBase title="Editing your message" onClose={onClose}>
      <ComposerPreviewContent
        edit={message}
        AnimatedMedia={AnimatedMedia}
        isGifUrl={isGifUrl}
        isEmojiOnly={isEmojiOnly}
        isVideoUrl={isVideoUrl}
      />
    </ComposerPreviewBase>
  );
};

interface ReplyingPreviewProps {
  reply: ReplyLike;
  currentUsername: string | null | undefined;
  onClose: () => void;
  AnimatedMedia: ComposerPreviewContentProps["AnimatedMedia"];
  isGifUrl: (s: string) => boolean;
  isEmojiOnly: (s?: string) => boolean;
  isVideoUrl: (s: string) => boolean;
}

export const ReplyingPreview: React.FC<ReplyingPreviewProps> = ({
  reply,
  currentUsername,
  onClose,
  AnimatedMedia,
  isGifUrl,
  isEmojiOnly,
  isVideoUrl,
}) => {
  // Keep parameter referenced to satisfy noUnusedParameters, but always show the
  // actual username instead of "You".
  void currentUsername;
  const title = `Replying to ${reply.username}`;
  return (
    <ComposerPreviewBase title={title} onClose={onClose}>
      <ComposerPreviewContent
        reply={reply}
        AnimatedMedia={AnimatedMedia}
        isGifUrl={isGifUrl}
        isEmojiOnly={isEmojiOnly}
        isVideoUrl={isVideoUrl}
      />
    </ComposerPreviewBase>
  );
};

export default ComposerPreviewBase;
