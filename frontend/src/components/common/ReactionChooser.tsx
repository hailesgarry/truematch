import React from "react";
import { useNavigate } from "react-router-dom";
import { Smiley, PlusCircle } from "@phosphor-icons/react";
import type { Message, ReactionEmoji } from "../../types";
import { useAuthStore } from "../../stores/authStore";
import { useSocketStore } from "../../stores/socketStore";

// Shared set (same 4 + one more available for quick-pick)
export const REACTION_CHOICES: ReactionEmoji[] = ["❤️", "😂", "😡", "👍", "😮"];

type Mode = "group" | "dm";

type Props = {
  message: Message;
  onPicked?: () => void; // close sheet after choosing
  mode?: Mode; // "group" (default) or "dm"
  dmId?: string; // required when mode="dm"
};

const ReactionChooser: React.FC<Props> = ({
  message,
  onPicked,
  mode = "group",
  dmId,
}) => {
  const navigate = useNavigate();
  const myUserId = useAuthStore((s) => s.userId) || "";
  const reactToMessage = useSocketStore((s) => s.reactToMessage);
  const reactToDirectMessage = useSocketStore((s) => s.reactToDirectMessage);

  const myReaction =
    (message.reactions && (message.reactions as any)[myUserId]?.emoji) || null;

  const choose = (emoji: ReactionEmoji) => {
    if (mode === "dm") {
      const msgWithDm = { ...(message as any), dmId };
      reactToDirectMessage(msgWithDm as any, emoji);
    } else {
      reactToMessage(message as any, emoji);
    }
    onPicked?.();
  };

  const openMore = () => {
    const target = {
      mode, // "group" | "dm"
      messageId: message.messageId || null,
      timestamp: message.timestamp || null,
      dmId: mode === "dm" ? dmId || null : null,
    };
    try {
      sessionStorage.setItem("reaction:target", JSON.stringify(target));
    } catch {}
    navigate("/emoji-picker", { state: { reactionTarget: target } });
  };

  const baseBtn =
    "w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-xl hover:bg-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400";

  return (
    // Make the row take the available width and space items across it
    <div className="flex items-center justify-between w-full">
      {REACTION_CHOICES.slice(0, 4).map((e) => {
        const active = myReaction === e;
        return (
          <button
            key={e}
            type="button"
            // Remove the ring; keep hover and focus styles for accessibility
            className={baseBtn}
            onClick={() => choose(e)}
            title={active ? "Remove my reaction" : "React"}
            aria-label={`React ${e}`}
            aria-pressed={active || undefined}
          >
            {e}
          </button>
        );
      })}

      {/* "Add more" smiley with a small plus badge */}
      <button
        type="button"
        onClick={openMore}
        aria-label="Add more emojis"
        title="Add more emojis"
        className={`${baseBtn} relative text-gray-700`}
      >
        <Smiley size={20} />
        <PlusCircle
          size={14}
          weight="fill"
          className="absolute -right-1 -bottom-1 text-gray-600 bg-white rounded-full"
          aria-hidden="true"
        />
      </button>
    </div>
  );
};

export default ReactionChooser;
