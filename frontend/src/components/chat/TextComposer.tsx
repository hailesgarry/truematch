import React from "react";
import AutoGrowTextarea from "../common/AutoGrowTextarea";
import {
  Gif,
  Smiley,
  PaperPlaneTilt,
  Check,
  Paperclip,
  Images,
} from "@phosphor-icons/react";
import DropDown from "../common/DropDown";
import type { DropDownItem } from "../common/DropDown";
import type { MediaUploadProps } from "../common/MediaUpload";
import type { VoiceRecorderProps } from "../common/VoiceRecorder";

type MentionDetectInfo = { start: number; end: number; token: string } | null;

interface MentionSupport {
  open: boolean;
  candidates: string[];
  index: number;
  setOpen: (open: boolean) => void;
  setQuery: (q: string) => void;
  setIndex: (index: number) => void;
  detect: (value: string, caret: number) => MentionDetectInfo;
  insert: (name: string) => void;
}

type TextAreaRef =
  | React.RefObject<HTMLTextAreaElement | null>
  | React.MutableRefObject<HTMLTextAreaElement | null>;

interface TextComposerProps {
  value: string;
  setValue: (text: string, cursorPos?: number) => void;
  setCursorPos: (pos: number) => void;
  inputRef: TextAreaRef;
  disabled: boolean;
  placeholder: string;
  onSend: () => void;
  onEscape?: () => void;
  onEmojiClick: () => void;
  onGifClick: () => void;
  renderMediaUpload: React.ReactElement<MediaUploadProps>;
  // Optional: voice recorder button (mic). When provided, TextComposer toggles
  // between showing this and the send button based on focus/emptiness.
  renderVoiceRecorder?: React.ReactNode;
  // When true, hide emoji/GIF/image controls and show provided inline recording controls
  recordingActive?: boolean;
  renderRecordingInline?: React.ReactNode;
  sendDisabled: boolean;
  editing: boolean;
  className?: string;
  // Optional mention support (only used on group chat)
  mention?: MentionSupport;
}

const TextComposer: React.FC<TextComposerProps> = ({
  value,
  setValue,
  setCursorPos,
  inputRef,
  disabled,
  placeholder,
  onSend,
  onEscape,
  onEmojiClick,
  onGifClick,
  renderMediaUpload,
  renderVoiceRecorder,
  recordingActive,
  renderRecordingInline,
  sendDisabled,
  editing,
  className,
  mention,
}) => {
  const hasMention = !!mention;
  const trimmed = (value || "").trim();
  const showMic =
    !!renderVoiceRecorder &&
    !editing &&
    trimmed.length === 0 &&
    !disabled &&
    !recordingActive;

  const mediaTriggerRef = React.useRef<(() => void) | null>(null);
  const registerMediaTrigger = React.useCallback((fn: (() => void) | null) => {
    mediaTriggerRef.current = fn;
  }, []);
  const [mediaBusy, setMediaBusy] = React.useState(false);

  const hiddenMediaUpload = React.useMemo(() => {
    const existingClassName = renderMediaUpload.props.className ?? "";
    return React.cloneElement<MediaUploadProps>(renderMediaUpload, {
      key: "hidden-media-upload",
      className: `${existingClassName} hidden`.trim(),
      onRegisterTrigger: registerMediaTrigger,
      onBusyChange: setMediaBusy,
    });
  }, [renderMediaUpload, registerMediaTrigger, setMediaBusy]);

  const attachmentMenuItems = React.useMemo<DropDownItem[]>(() => {
    const buildActionItem = (
      key: string,
      label: string,
      iconRenderer: () => React.ReactNode,
      handler: () => void,
      opts?: { disabled?: boolean; onMouseDown?: (e: React.MouseEvent) => void }
    ): DropDownItem => ({
      key,
      renderCustom: ({ close }) => {
        const disabledState = Boolean(opts?.disabled);
        const handleClick = () => {
          if (disabledState) return;
          close();
          handler();
        };
        return (
          <div className="px-4 py-2">
            <button
              type="button"
              onMouseDown={opts?.onMouseDown}
              onClick={handleClick}
              disabled={disabledState}
              className={`flex w-full items-center gap-2 p-0 text-left text-sm font-medium text-gray-900 focus:outline-none ${
                disabledState ? "opacity-50 cursor-not-allowed" : ""
              }`}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 shrink-0">
                {iconRenderer()}
              </span>
              <span>{label}</span>
            </button>
          </div>
        );
      },
    });

    const items: DropDownItem[] = [
      buildActionItem(
        "emoji",
        "Emoji",
        () => <Smiley size={20} weight="fill" />,
        onEmojiClick
      ),
      buildActionItem(
        "gif",
        "GIF",
        () => <Gif size={20} weight="fill" />,
        onGifClick
      ),
    ];

    const mediaDisabled = Boolean(renderMediaUpload.props.disabled);
    const mediaLabel = renderMediaUpload.props.label ?? "Media";

    items.push(
      buildActionItem(
        "media",
        mediaBusy ? `${mediaLabel}...` : mediaLabel,
        () => <Images size={20} weight="fill" />,
        () => {
          const open = mediaTriggerRef.current;
          if (!open) return;
          if (
            typeof window !== "undefined" &&
            typeof window.requestAnimationFrame === "function"
          ) {
            window.requestAnimationFrame(() => open());
          } else {
            setTimeout(() => open(), 0);
          }
        },
        {
          disabled: mediaDisabled || mediaBusy,
          onMouseDown: (e) => e.preventDefault(),
        }
      )
    );

    return items;
  }, [onEmojiClick, onGifClick, renderMediaUpload, mediaBusy]);

  const recorderNode = React.useMemo(() => {
    if (!renderVoiceRecorder) return null;
    if (React.isValidElement<VoiceRecorderProps>(renderVoiceRecorder)) {
      const existingWrapper = renderVoiceRecorder.props.className ?? "";
      const existingButton = renderVoiceRecorder.props.buttonClassName ?? "";
      return React.cloneElement<VoiceRecorderProps>(renderVoiceRecorder, {
        className: `${existingWrapper} flex items-center justify-center`.trim(),
        buttonClassName:
          `${existingButton} flex h-10 w-10 items-center justify-center rounded-full bg-primary-gradient text-white shadow-sm transition`.trim(),
      });
    }
    return renderVoiceRecorder;
  }, [renderVoiceRecorder]);

  return (
    <div className={className ? className : "relative"}>
      {/* Center the row so the send button aligns with the textarea vertically */}
      <div className="flex items-center gap-2">
        {recordingActive ? (
          <div className="flex flex-1 items-center justify-center rounded-full bg-gray-100/90 px-4 py-3 shadow-sm">
            {renderRecordingInline}
          </div>
        ) : (
          <div className="relative flex-1">
            {/* Composer input inside a rounded container with tighter inner spacing */}
            <div
              className={`relative w-full rounded-full bg-gray-100/90 pl-8 pr-28 py-2 flex items-center shadow-sm`}
            >
              <AutoGrowTextarea
                ref={inputRef}
                className="w-full border-0 bg-transparent p-0 outline-none focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed resize-none text-sm leading-5"
                value={value}
                maxRows={3}
                placeholder={placeholder}
                disabled={disabled}
                onChange={(e) => {
                  const val = e.target.value;
                  const caret = e.target.selectionStart ?? val.length;
                  setValue(val, caret);

                  if (hasMention && mention) {
                    const info = mention.detect(val, caret);
                    if (info) {
                      const q = info.token.slice(1);
                      mention.setQuery(q);
                      mention.setOpen(true);
                      mention.setIndex(0);
                    } else if (mention.open) {
                      mention.setOpen(false);
                      mention.setQuery("");
                    }
                  }
                }}
                onClick={(e) => {
                  const el = e.currentTarget;
                  setCursorPos(el.selectionStart ?? 0);
                }}
                onKeyUp={(e) => {
                  const el = e.currentTarget;
                  setCursorPos(el.selectionStart ?? 0);
                }}
                onSelect={(e) => {
                  const el = e.currentTarget as HTMLTextAreaElement;
                  setCursorPos(el.selectionStart ?? 0);
                }}
                onKeyDown={(e) => {
                  if (hasMention && mention && mention.open) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      const len = mention.candidates.length;
                      mention.setIndex(len ? (mention.index + 1) % len : 0);
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      const len = mention.candidates.length;
                      mention.setIndex(
                        len ? (mention.index - 1 + len) % len : 0
                      );
                      return;
                    }
                    if (e.key === "Enter" || e.key === "Tab") {
                      if (mention.candidates.length) {
                        e.preventDefault();
                        mention.insert(mention.candidates[mention.index]);
                        return;
                      }
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      mention.setOpen(false);
                      mention.setQuery("");
                      return;
                    }
                  }

                  // Enter sends; Shift+Enter inserts newline
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onSend();
                  }
                  if (e.key === "Escape") {
                    onEscape?.();
                  }
                }}
              />

              {/* Inline controls stay anchored on the right while typing */}
              <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
                <DropDown
                  className="pointer-events-auto pr-2"
                  buttonClassName={`flex h-9 w-9 items-center justify-center rounded-full text-gray-500 focus:outline-none ${
                    disabled ? "opacity-40" : ""
                  }`}
                  triggerIcon={<Paperclip size={24} />}
                  triggerAriaLabel="Open attachment options"
                  disabled={disabled}
                  placement="top-end"
                  items={attachmentMenuItems}
                  offset={{ mainAxis: 12 }}
                  openAnimation="slide-from-bottom"
                />
              </div>
            </div>
          </div>
        )}

        {/* Right action: either Mic (idle) or Send (focused/text/editing) */}
        {recorderNode && (
          <div
            className={`flex items-center${showMic ? "" : " hidden"}`}
            aria-hidden={!showMic}
          >
            {recorderNode}
          </div>
        )}

        <button
          type="button"
          onClick={onSend}
          disabled={sendDisabled}
          aria-label={editing ? "Save edited message" : "Send message"}
          className={`flex h-10 w-10 items-center justify-center rounded-full focus:outline-none transition ${
            sendDisabled
              ? "bg-red-300 text-white/70 cursor-not-allowed"
              : "bg-primary-gradient text-white"
          }${showMic ? " hidden" : ""}`}
        >
          {editing ? (
            <Check size={20} weight="bold" />
          ) : (
            <PaperPlaneTilt size={24} weight="fill" />
          )}
        </button>
      </div>

      {/* Mention dropdown */}
      {hasMention &&
        mention &&
        mention.open &&
        mention.candidates.length > 0 && (
          <div
            className="absolute bottom-full mb-1 left-0 w-64 max-h-60 overflow-auto rounded-md border bg-white shadow-lg text-sm z-50"
            role="listbox"
            aria-label="Mention suggestions"
          >
            {mention.candidates.map((u, i) => {
              const active = i === mention.index;
              return (
                <button
                  key={u}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseDown={(ev) => {
                    ev.preventDefault();
                    mention.insert(u);
                  }}
                  className={`block w-full text-left px-3 py-1.5 border-b last:border-b-0 ${
                    active
                      ? "bg-white font-semibold text-gray-900"
                      : "bg-white text-gray-700"
                  } focus:outline-none`}
                >
                  @{u}
                </button>
              );
            })}
          </div>
        )}
      <div aria-hidden={true} className="hidden">
        {hiddenMediaUpload}
      </div>
    </div>
  );
};

export default TextComposer;
