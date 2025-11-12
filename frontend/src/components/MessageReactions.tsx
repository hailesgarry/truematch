import React from "react";
import { Smiley } from "phosphor-react";
import type { Message, ReactionEmoji } from "../types";
import { useAuthStore } from "../stores/authStore";
import { useSocketStore } from "../stores/socketStore";

// Contract
// props:
// - groupId: string (current group id)
// - message: Message (message to react to)
// - currentUser: string (username of current user; optional for display)
// - align?: "left" | "right"
// behavior:
// - one reaction per user per message (server-enforced)
// - selecting the same emoji again removes your reaction (server toggle)
// - rendered counts and most-recent come from live store updates

type Mode = "group" | "dm";

type Props = {
  groupId: string;
  message: Message;
  currentUser: string;
  align?: "left" | "right";
  // NEW: when true, hide the smiley trigger + popover, show only the count
  hidePicker?: boolean;
  // NEW: callback when the count/summary is clicked (to open a drawer)
  onCountClick?: (message: Message) => void;
  // NEW: allow reuse in DMs by switching the underlying socket call
  mode?: Mode;
  dmId?: string | null;
};

const EMOJI_CHOICES: ReactionEmoji[] = ["❤️", "😂", "😡", "👍", "😮"];

const MessageReactions: React.FC<Props> = ({
  groupId: _groupId,
  message,
  currentUser: _currentUser,
  align = "left",
  hidePicker = false, // NEW default
  onCountClick,
  mode = "group",
  dmId,
}) => {
  const [open, setOpen] = React.useState(false);
  const btnRef = React.useRef<HTMLButtonElement | null>(null);
  const popRef = React.useRef<HTMLDivElement | null>(null);

  // Prefer stable userId to identify "my" reaction
  const myUserId = useAuthStore((s) => s.userId) || "";
  const reactToMessage = useSocketStore((s) => s.reactToMessage);
  const reactToDirectMessage = useSocketStore((s) => s.reactToDirectMessage);

  const map = (message.reactions as Record<string, any>) || {};
  const myReaction =
    (map[myUserId]?.emoji as ReactionEmoji | undefined) || null;

  const entries = Object.entries(map) as Array<
    [string, { emoji: ReactionEmoji; at: number; username?: string }]
  >;
  const totalCount = entries.length;

  const sortedEntries = React.useMemo(() => {
    return entries.slice().sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
  }, [entries]);

  const uniqueEmojis = React.useMemo(() => {
    const seen = new Set<ReactionEmoji>();
    const ordered: ReactionEmoji[] = [];
    for (const [, info] of sortedEntries) {
      if (!seen.has(info.emoji)) {
        seen.add(info.emoji);
        ordered.push(info.emoji);
      }
    }
    return ordered;
  }, [sortedEntries]);

  const emojiCounts = React.useMemo(() => {
    const counts = new Map<ReactionEmoji, number>();
    for (const [, info] of entries) {
      const current = counts.get(info.emoji) || 0;
      counts.set(info.emoji, current + 1);
    }
    return counts;
  }, [entries]);

  const displayedEmojis = React.useMemo(() => {
    if (!uniqueEmojis.length) return [] as ReactionEmoji[];
    const limit = Math.min(3, uniqueEmojis.length);
    return uniqueEmojis.slice(0, limit);
  }, [uniqueEmojis]);

  const displayItems = React.useMemo(
    () =>
      displayedEmojis.map((emoji, index) => ({
        key: `emoji-${emoji}-${index}`,
        emoji,
      })),
    [displayedEmojis]
  );

  const summaryLabel = React.useMemo(() => {
    if (!totalCount) return "";
    const parts: string[] = [];
    uniqueEmojis.forEach((emoji) => {
      const count = emojiCounts.get(emoji);
      if (!count) return;
      parts.push(`${emoji} ${count}`);
    });
    emojiCounts.forEach((count, emoji) => {
      if (!uniqueEmojis.includes(emoji)) {
        parts.push(`${emoji} ${count}`);
      }
    });
    return parts.join(", ");
  }, [emojiCounts, totalCount, uniqueEmojis]);

  function choose(emoji: ReactionEmoji) {
    if (mode === "dm") {
      const payload =
        dmId && !(message as any).dmId
          ? ({ ...(message as any), dmId } as Message)
          : message;
      reactToDirectMessage(payload, emoji);
    } else {
      reactToMessage(message, emoji); // server will toggle if same
    }
    setOpen(false);
  }

  // close on outside click / escape
  React.useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const justify = align === "right" ? "justify-end" : "justify-start";
  const itemsAlign = align === "right" ? "items-end" : "items-start";
  const alignSelfClass = align === "right" ? "self-end" : "self-start";
  const baseBadgeClass =
    "relative flex items-center justify-center rounded-full bg-white ring ring-white";
  const emojiBadgeClass = "h-4 w-4 text-sm";

  return (
    <div className={`mt-0 flex ${justify}`}>
      <div className={`flex flex-col ${itemsAlign} gap-1`}>
        {/* Reaction summary */}
        {displayItems.length > 0 && totalCount > 0 && (
          <div
            className={`${alignSelfClass} max-w-full select-none`}
            title={summaryLabel || undefined}
            role={onCountClick ? "button" : undefined}
            tabIndex={onCountClick ? 0 : -1}
            onClick={(e) => {
              if (!onCountClick) return;
              e.stopPropagation();
              onCountClick(message);
            }}
            onKeyDown={(e) => {
              if (!onCountClick) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onCountClick(message);
              }
            }}
            aria-label={
              onCountClick
                ? `View ${totalCount} reactions`
                : summaryLabel || undefined
            }
          >
            <div className="inline-flex items-center">
              <div className="inline-flex items-center gap-0">
                {displayItems.map((item, index) => {
                  const zIndex = displayItems.length - index;
                  return (
                    <span
                      key={item.key}
                      className={`${baseBadgeClass} ${emojiBadgeClass}`}
                      style={{ zIndex }}
                    >
                      {item.emoji}
                    </span>
                  );
                })}
              </div>
              <span className="ml-2 text-xs font-semibold text-gray-900">
                {totalCount}
              </span>
            </div>
          </div>
        )}

        {/* Popover — only when picker is visible */}
        {!hidePicker && (
          <div className={`relative ${alignSelfClass}`}>
            <button
              ref={btnRef}
              type="button"
              className="text-gray-500 focus:outline-none"
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-label={
                myReaction ? `Change reaction (${myReaction})` : "Add reaction"
              }
              onClick={(e) => {
                e.stopPropagation();
                setOpen((o) => !o);
              }}
            >
              <Smiley size={18} />
            </button>

            {open && (
              <div
                ref={popRef}
                role="dialog"
                aria-label="Choose a reaction"
                className={`absolute z-50 mt-2 ${
                  align === "right" ? "right-0" : "left-0"
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-1 rounded-lg border bg-white p-2 shadow-lg">
                  {EMOJI_CHOICES.map((e) => {
                    const active = e === myReaction;
                    return (
                      <button
                        key={e}
                        type="button"
                        className={`h-8 w-8 rounded-full text-xl leading-none hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                          active ? "ring-2 ring-blue-400" : ""
                        }`}
                        onClick={() => choose(e)}
                        title={
                          active ? "Remove my reaction" : "Select reaction"
                        }
                      >
                        {e}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageReactions;
