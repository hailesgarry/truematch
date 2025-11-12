import React from "react";
import BottomSheet from "../common/BottomSheet";
import {
  ArrowBendLeftUp,
  At,
  CopySimple,
  PencilSimple,
  Trash,
  Flag,
  Microphone,
} from "@phosphor-icons/react";
import type { Message } from "../../types";
import { useAudioDuration } from "../../hooks/useAudioDuration";
import { formatDuration } from "../../utils/formatDuration";

type Mode = "group" | "dm";

type Props = {
  open: boolean;
  onClose: () => void;
  mode?: Mode; // default: group
  username: string | null | undefined;
  uiKind: "actions" | "confirm-delete" | "idle";
  message: Message | null;
  handlers: {
    onReply: () => void;
    onMention?: () => void; // group only
    onCopy?: () => void;
    onEdit: () => void;
    onDelete: () => void;
    onConfirmDelete: () => void;
    onCancelDelete: () => void;
  };
  editDisabled: boolean;
  deleteDisabled: boolean;
  editKindBlocked?: boolean;
  copyDisabled?: boolean;
  isGifUrl: (s: string) => boolean;
  isVideoUrl: (s: string) => boolean;
  AnimatedMedia: React.FC<{
    url: string;
    mediaSources?: {
      mp4?: string;
      webm?: string;
      gif?: string;
      preview?: string;
    };
  }>;
};

const MessageActionSheet: React.FC<Props> = ({
  open,
  onClose,
  mode = "group",
  username,
  uiKind,
  message,
  handlers,
  editDisabled,
  deleteDisabled,
  editKindBlocked,
  copyDisabled,
  isGifUrl,
  isVideoUrl,
  AnimatedMedia,
}) => {
  // Remove the sheet title entirely for a cleaner look
  const title = undefined;

  const audioMeta = React.useMemo(() => {
    if (!message) return null;
    const candidate = (message as any).audio;
    const isAudio =
      (message as any).kind === "audio" ||
      (candidate && typeof candidate === "object");
    if (!isAudio || !candidate) return null;
    const url = typeof candidate.url === "string" ? candidate.url : undefined;
    const durationMs =
      typeof candidate.durationMs === "number" &&
      Number.isFinite(candidate.durationMs)
        ? candidate.durationMs
        : undefined;
    return { url, durationMs };
  }, [message]);

  const audioDurationMs = useAudioDuration(
    audioMeta?.url,
    audioMeta?.durationMs
  );

  const voiceSummary = React.useMemo(() => {
    if (!audioMeta) return null;
    const effective =
      typeof audioDurationMs === "number" && Number.isFinite(audioDurationMs)
        ? audioDurationMs
        : audioMeta.durationMs;
    const label = formatDuration(effective);
    return `Voice note (${label})`;
  }, [audioMeta, audioDurationMs]);

  return (
    <BottomSheet
      isOpen={open}
      onClose={onClose}
      title={title}
      ariaDescription="Actions you can take on the selected message"
    >
      {message && uiKind === "actions" && (
        <div className="space-y-2" key="actions">
          <button
            onClick={handlers.onReply}
            className="w-full text-left py-2.5 text-sm flex items-center gap-2"
            data-autofocus
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 shrink-0">
              <ArrowBendLeftUp size={20} weight="fill" />
            </span>
            <span>Reply</span>
          </button>

          {mode === "group" && handlers.onMention && (
            <button
              onClick={handlers.onMention}
              className="w-full text-left py-2.5 text-sm flex items-center gap-2"
              title="Mention this user"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 shrink-0">
                <At size={20} weight="fill" />
              </span>
              <span>Mention</span>
            </button>
          )}

          {handlers.onCopy && (
            <button
              onClick={handlers.onCopy}
              disabled={copyDisabled}
              className={`w-full text-left py-2 text-sm flex items-center gap-2${
                copyDisabled ? " cursor-not-allowed opacity-70" : ""
              }`}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 shrink-0">
                <CopySimple size={20} weight="fill" />
              </span>
              <span>Copy</span>
            </button>
          )}

          {message.username === username && (
            <>
              <button
                onClick={handlers.onEdit}
                disabled={editDisabled}
                className={`w-full text-left py-2 text-sm flex items-center gap-2${
                  editDisabled ? " cursor-not-allowed opacity-70" : ""
                }`}
                title={
                  editKindBlocked
                    ? "Editing is disabled for GIF-only or emoji-only messages"
                    : undefined
                }
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 shrink-0">
                  <PencilSimple size={20} weight="fill" />
                </span>
                <span>Edit</span>
              </button>
              <button
                onClick={handlers.onDelete}
                disabled={deleteDisabled}
                className={`w-full text-left py-2 text-sm flex items-center gap-2${
                  deleteDisabled
                    ? " text-red-400 cursor-not-allowed"
                    : " text-red-600"
                }`}
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 shrink-0">
                  <Trash size={20} weight="fill" />
                </span>
                <span>Delete</span>
              </button>
            </>
          )}

          <button
            onClick={() => {
              // placeholder for spam report; page previously did console + close
              try {
                console.log("Report spam", message);
              } catch {}
              onClose();
            }}
            className="w-full text-left py-2.5 text-sm flex items-center gap-2"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 shrink-0">
              <Flag size={20} weight="fill" />
            </span>
            <span>Report as spam</span>
          </button>
        </div>
      )}

      {message && uiKind === "confirm-delete" && (
        <div className="space-y-4 text-center" role="alert" key="confirm">
          <div className="text-sm font-semibold text-red-600 flex items-center gap-2 justify-center">
            <Trash size={22} className="text-current" aria-hidden />
            Delete message?
          </div>
          <div className="text-xs text-gray-500 leading-snug">
            This will permanently mark the message as deleted for everyone.
          </div>
          <div className="p-3 rounded-md border border-gray-200 bg-white text-sm text-gray-700 mx-auto">
            <div className="flex items-center gap-2 min-w-0">
              {(() => {
                const m = message as any;
                const text = (m.text || "").trim();
                const structuredMedia = m.kind === "media" && m.media;
                const structuredGif = m.kind === "gif" && m.media;
                const singleGifUrl =
                  !!text && isGifUrl(text) && !text.includes(" ");
                if (voiceSummary) {
                  return (
                    <span className="flex items-center gap-2 text-gray-600">
                      <Microphone size={16} weight="fill" />
                      <span className="truncate tabular-nums">
                        {voiceSummary}
                      </span>
                    </span>
                  );
                }

                if (structuredMedia) {
                  const media = m.media;
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

                if (structuredGif) {
                  const media = m.media;
                  const origin = media.original || media.gif || text || "";
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

                if (singleGifUrl) {
                  return (
                    <span className="inline-block max-w-[60px] max-h-[60px]">
                      <AnimatedMedia url={text} />
                    </span>
                  );
                }

                return null;
              })()}
              {(() => {
                // Show text-only preview only when there's no media/gif/audio
                const m = message as any;
                const text = (m.text || "").trim();
                const hasMedia =
                  voiceSummary ||
                  (m.kind === "media" && m.media) ||
                  (m.kind === "gif" && m.media) ||
                  (!!text && isGifUrl(text) && !text.includes(" "));
                if (hasMedia) return null;
                return (
                  <div className="italic line-clamp-2 break-words">
                    {text || (
                      <span className="not-italic text-gray-400">
                        (empty message)
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              onClick={handlers.onCancelDelete}
              className="flex-1 px-4 py-2 rounded-md bg-gray-100 text-sm font-medium text-gray-700 hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
              data-autofocus
            >
              Cancel
            </button>
            <button
              onClick={handlers.onConfirmDelete}
              disabled={deleteDisabled}
              className={`flex-1 px-4 py-2 rounded-md text-sm font-semibold focus:outline-none focus-visible:ring ${
                deleteDisabled
                  ? "bg-red-300 cursor-not-allowed text-white"
                  : "bg-red-600 hover:bg-red-700 text-white focus-visible:ring-red-500"
              }`}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
};

export default MessageActionSheet;
