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

type Props = {
  groupId: string;
  message: Message;
  currentUser: string;
  align?: "left" | "right";
  // NEW: when true, hide the smiley trigger + popover, show only the count
  hidePicker?: boolean;
  // NEW: callback when the count/summary is clicked (to open a drawer)
  onCountClick?: (message: Message) => void;
};

const EMOJI_CHOICES: ReactionEmoji[] = ["❤️", "😂", "😡", "👍", "😮"];

const MessageReactions: React.FC<Props> = ({
  groupId: _groupId,
  message,
  currentUser: _currentUser,
  align = "left",
  hidePicker = false, // NEW default
  onCountClick,
}) => {
  const [open, setOpen] = React.useState(false);
  const btnRef = React.useRef<HTMLButtonElement | null>(null);
  const popRef = React.useRef<HTMLDivElement | null>(null);

  // Prefer stable userId to identify "my" reaction
  const myUserId = useAuthStore((s) => s.userId) || "";
  const reactToMessage = useSocketStore((s) => s.reactToMessage);

  const map = (message.reactions as Record<string, any>) || {};
  const myReaction =
    (map[myUserId]?.emoji as ReactionEmoji | undefined) || null;

  const entries = Object.entries(map) as Array<
    [string, { emoji: ReactionEmoji; at: number; username?: string }]
  >;
  const totalCount = entries.length;

  const mostRecent = React.useMemo(() => {
    if (!entries.length)
      return null as null | { emoji: ReactionEmoji; at: number; user: string };
    const sorted = entries
      .slice()
      .sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
    const last = sorted[sorted.length - 1];
    return {
      emoji: last[1].emoji,
      at: last[1].at,
      user: last[1].username || "",
    };
  }, [message.reactions, entries.length]);

  function choose(emoji: ReactionEmoji) {
    reactToMessage(message, emoji); // server will toggle if same
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

  return (
    <div className={`mt-2 flex ${justify}`}>
      <div className={`relative flex items-center gap-2.5 ${itemsAlign}`}>
        {/* Smiley trigger — hidden when hidePicker is true */}
        {!hidePicker && (
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
        )}

        {/* Count (unchanged) */}
        {mostRecent && totalCount > 0 && (
          <div
            className="text-xs text-gray-700 select-none inline-flex items-center gap-0.5"
            title={`Most recent by ${mostRecent.user} • ${new Date(
              mostRecent.at
            ).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}`}
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
              onCountClick ? `View ${totalCount} reactions` : undefined
            }
          >
            <span>{mostRecent.emoji}</span>
            <span className="text-gray-600">{totalCount}</span>
          </div>
        )}

        {/* Popover — only when picker is visible */}
        {!hidePicker && open && (
          <div
            ref={popRef}
            role="dialog"
            aria-label="Choose a reaction"
            className={`absolute z-50 -top-2 ${
              align === "right" ? "right-10" : "left-10"
            } translate-y-[-100%]`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="rounded-lg border bg-white shadow-lg p-2 flex items-center gap-1">
              {EMOJI_CHOICES.map((e) => {
                const active = e === myReaction;
                return (
                  <button
                    key={e}
                    type="button"
                    className={`text-xl leading-none w-8 h-8 rounded-full hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                      active ? "ring-2 ring-blue-400" : ""
                    }`}
                    onClick={() => choose(e)}
                    title={active ? "Remove my reaction" : "Select reaction"}
                  >
                    {e}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageReactions;
