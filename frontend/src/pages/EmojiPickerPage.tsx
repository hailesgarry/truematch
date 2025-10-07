import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import EmojiPicker, { Theme } from "emoji-picker-react";
import type { EmojiClickData } from "emoji-picker-react";
import { ArrowLeft } from "phosphor-react";
import { useComposerStore } from "../stores/composerStore";
import { addRecentEmoji, loadRecentEmojis } from "../utils/recents";
import { useSocketStore } from "../stores/socketStore"; // already present

const EmojiPickerPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const insertEmoji = useComposerStore((s) => s.insertEmoji);
  const requestFocus = useComposerStore((s) => s.requestFocus);
  const reactToMessage = useSocketStore((s) => s.reactToMessage);
  const reactToDirectMessage = useSocketStore((s) => s.reactToDirectMessage);
  const activeDmId = useSocketStore((s) => s.activeDmId); // NEW fallback

  const [recent, setRecent] = React.useState<string[]>(() =>
    loadRecentEmojis()
  );

  // NEW: pull from router state as well
  const stateTarget = (location.state as any)?.reactionTarget;

  const reactionTarget = React.useMemo(() => {
    try {
      const raw = sessionStorage.getItem("reaction:target");
      if (raw) return JSON.parse(raw);
    } catch {}
    return stateTarget || null;
  }, [location.key, stateTarget]);

  const inReactionMode =
    !!reactionTarget &&
    (reactionTarget.mode === "group" || reactionTarget.mode === "dm");

  const handleEmoji = (emoji: string) => {
    if (inReactionMode) {
      const mode = reactionTarget.mode as "group" | "dm";
      const dmId =
        mode === "dm"
          ? (reactionTarget.dmId as string | null) || activeDmId || undefined
          : undefined;

      const minimalMsg = {
        messageId: reactionTarget.messageId || undefined,
        timestamp: reactionTarget.timestamp || undefined,
        ...(mode === "dm" ? { dmId } : {}),
      } as any;

      if (mode === "dm") {
        if (!dmId) {
          console.warn("Missing dmId for reaction; aborting.");
          try {
            sessionStorage.removeItem("reaction:target");
          } catch {}
          navigate(-1);
          return;
        }
        reactToDirectMessage(minimalMsg, emoji as any);
      } else {
        reactToMessage(minimalMsg, emoji as any);
      }

      try {
        sessionStorage.removeItem("reaction:target");
      } catch {}
      addRecentEmoji(emoji);
      setRecent(loadRecentEmojis());
      navigate(-1);
      return;
    }

    // composer insertion
    insertEmoji(emoji);
    addRecentEmoji(emoji);
    setRecent(loadRecentEmojis());
    requestFocus();
    navigate(-1);
  };

  const handleEmojiClick = (data: EmojiClickData) => handleEmoji(data.emoji);
  const useRecent = (e: string) => handleEmoji(e);

  return (
    <div className="flex flex-col min-h-[100dvh] bg-white overscroll-y-contain overflow-y-auto pt-[calc(env(safe-area-inset-top)+56px)] pb-[env(safe-area-inset-bottom)]">
      <header className="fixed inset-x-0 top-0 z-20 flex h-14 items-center gap-4 px-4 border-b bg-white">
        <button
          onClick={() => {
            try {
              sessionStorage.removeItem("reaction:target");
            } catch {}
            navigate(-1);
          }}
          aria-label="Back to chat"
          className="text-gray-900"
        >
          <ArrowLeft size={24} />
        </button>
        <h1 className="text-base font-semibold text-gray-900">
          {inReactionMode ? "Pick a reaction" : "Pick an emoji"}
        </h1>
      </header>

      {recent.length > 0 && (
        <div className="px-3 pt-2">
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
            Recent
          </div>
          <div className="flex flex-wrap gap-1 pb-2 border-b">
            {recent.map((e) => (
              <button
                key={e}
                onClick={() => useRecent(e)}
                className="w-9 h-9 text-xl flex items-center justify-center focus:outline-none"
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 p-4">
        <EmojiPicker
          onEmojiClick={handleEmojiClick}
          autoFocusSearch={false}
          lazyLoadEmojis
          theme={Theme.LIGHT}
          width="100%"
          height="100%"
          searchPlaceholder="Search emoji..."
        />
      </div>
    </div>
  );
};

export default EmojiPickerPage;
