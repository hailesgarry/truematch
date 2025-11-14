import React from "react";
import DropDown, { type DropDownItem } from "../common/DropDown";
import type { Message, ReactionEmoji } from "../../types";

export type MessageActionModalMode = "group" | "dm";

export type MessageActionModalProps = {
  open: boolean;
  onClose: () => void;
  mode?: MessageActionModalMode;
  username: string | null | undefined;
  uiKind: "actions" | "confirm-delete" | "idle";
  message: Message | null;
  handlers: {
    onReply: () => void;
    onMention?: () => void;
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
  quickReactions?: {
    emojis: ReactionEmoji[];
    onSelect: (emoji: ReactionEmoji) => void;
    disabled?: boolean;
  };
  anchorRect?: DOMRect | null;
};
const MessageActionModal: React.FC<MessageActionModalProps> = (props) => {
  const { open, onClose, quickReactions, anchorRect } = props;
  const hasEmojis = Boolean(quickReactions?.emojis?.length);

  if (!hasEmojis || !quickReactions) {
    return null;
  }

  const disabled = Boolean(quickReactions.disabled);

  const anchorStyle = React.useMemo<React.CSSProperties>(() => {
    if (anchorRect) {
      return {
        position: "fixed",
        top: Math.max(anchorRect.bottom, 0),
        left: anchorRect.left + anchorRect.width / 2,
        transform: "translate(-50%, 0)",
        width: Math.max(anchorRect.width, 1),
        height: 1,
        pointerEvents: "none",
      };
    }

    return {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      width: 240,
      height: 1,
      pointerEvents: "none",
    };
  }, [anchorRect]);

  const items = React.useMemo<DropDownItem[]>(() => {
    if (!quickReactions.emojis.length) {
      return [];
    }

    return [
      {
        key: "emoji-grid",
        renderCustom: ({ close }) => (
          <div className="flex flex-wrap justify-center gap-4 px-6 py-6">
            {quickReactions.emojis.map((emoji, index) => (
              <button
                key={`${emoji}-${index}`}
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (disabled) return;
                  quickReactions.onSelect(emoji);
                  close();
                }}
                data-autofocus={index === 0}
                className={`h-14 w-14 rounded-full bg-gray-50 text-3xl leading-none shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${
                  disabled
                    ? "opacity-50 cursor-not-allowed"
                    : "hover:bg-gray-100"
                }`}
                aria-label={`React ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        ),
      },
    ];
  }, [quickReactions, disabled]);

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next) {
        onClose();
      }
    },
    [onClose]
  );

  if (!items.length) {
    return null;
  }

  return (
    <DropDown
      open={open}
      onOpenChange={handleOpenChange}
      placement="bottom-start"
      offset={{ mainAxis: anchorRect ? 12 : 0, crossAxis: 0 }}
      items={items}
      openAnimation="slide-from-top"
      renderTrigger={({ ref }) => (
        <button
          ref={ref}
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className="pointer-events-none h-0 w-0 border-0 bg-transparent p-0"
          style={anchorStyle}
        />
      )}
    />
  );
};

export default MessageActionModal;
