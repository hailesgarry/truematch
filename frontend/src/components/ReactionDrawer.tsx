import React from "react";
import { useNavigate } from "react-router-dom";
import Drawer from "./common/Drawer";
import type { Message, UserReaction } from "../types";
import { useAvatarStore } from "../stores/avatarStore";
import { usePresenceStore } from "../stores/presenceStore";

type ReactionDrawerProps = {
  open: boolean;
  onClose: () => void;
  message: Message | null;
  title?: string;
};

const ReactionDrawer: React.FC<ReactionDrawerProps> = ({
  open,
  onClose,
  message,
  title,
}) => {
  const navigate = useNavigate();
  const getAvatar = useAvatarStore((s) => s.getAvatar);
  const isOnline = usePresenceStore((s) => s.isOnline);

  const reactions: Array<UserReaction> = React.useMemo(() => {
    if (!message || !message.reactions) return [];
    // message.reactions is Record<userId, UserReaction>
    return Object.values(message.reactions).sort(
      (a, b) => (b.at || 0) - (a.at || 0)
    );
  }, [message?.reactions, message?.messageId]);

  const handleViewProfile = (username?: string) => {
    const u = (username || "").trim();
    if (!u) return;
    navigate(`/u/${encodeURIComponent(u)}`);
    onClose();
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      side="left"
      width={280}
      title={title || "Reactions"}
      showCloseButton={false}
    >
      {!message || reactions.length === 0 ? (
        <div className="text-sm text-gray-500">No reactions yet.</div>
      ) : (
        <ul className="divide-y">
          {reactions.map((r, idx) => {
            const avatar = getAvatar(r.username) || null;
            const online = isOnline(r.username);
            return (
              <li
                key={`${r.userId}-${idx}`}
                className="p-4 flex items-center gap-3"
              >
                {/* avatar */}
                <div className="relative w-10 h-10">
                  <div className="absolute inset-0 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center text-xs font-semibold">
                    {avatar ? (
                      <img
                        src={avatar}
                        alt={`${r.username} avatar`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-gray-600 select-none">
                        {(r.username || "?").slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </div>
                  {online && (
                    <span
                      className="absolute bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 ring-2 ring-white"
                      aria-hidden
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleViewProfile(r.username);
                    }}
                    className="text-left text-sm text-gray-900 truncate cursor-pointer focus:outline-none"
                    aria-label={`View ${r.username}'s profile`}
                  >
                    {r.username}
                  </button>
                  <div
                    className="text-xl flex-shrink-0"
                    aria-label={`Reaction ${r.emoji}`}
                  >
                    {r.emoji}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Drawer>
  );
};

export default ReactionDrawer;
