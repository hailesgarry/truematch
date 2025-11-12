import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import EmojiPicker, { Theme } from "emoji-picker-react";
import type { EmojiClickData } from "emoji-picker-react";
import {
  X,
  ClockClockwise,
  Smiley,
  Cat,
  Hamburger,
  AirplaneTilt,
  TShirt,
  Prohibit,
  Flag,
  SoccerBall,
} from "phosphor-react";
import { useComposerStore } from "../stores/composerStore";
import { addRecentEmoji, loadRecentEmojis } from "../utils/recents";
import { useSocketStore } from "../stores/socketStore"; // already present

type Props = { onClose?: () => void };

const EmojiPickerPage: React.FC<Props> = ({ onClose }) => {
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

  const close = () => {
    if (onClose) onClose();
    else navigate(-1);
  };

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
          close();
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
      close();
      return;
    }

    // composer insertion
    insertEmoji(emoji);
    addRecentEmoji(emoji);
    setRecent(loadRecentEmojis());
    requestFocus();
    close();
  };

  const handleEmojiClick = (data: EmojiClickData) => handleEmoji(data.emoji);
  const useRecent = (e: string) => handleEmoji(e);

  // Ensure category navigation works reliably by intercepting clicks
  const pickerRef = React.useRef<HTMLDivElement | null>(null);
  const [activeCat, setActiveCat] = React.useState<string>("smileys");

  const CATEGORIES: Array<{
    key: string;
    label: string;
    names: string[];
    Icon: React.ComponentType<{ size?: number }>;
  }> = [
    { key: "recent", label: "Recent", names: ["recent"], Icon: ClockClockwise },
    {
      key: "smileys",
      label: "Smileys",
      names: ["smileys", "people"],
      Icon: Smiley,
    },
    {
      key: "animals",
      label: "Animals",
      names: ["animals", "nature"],
      Icon: Cat,
    },
    { key: "food", label: "Food", names: ["food", "drink"], Icon: Hamburger },
    {
      key: "activities",
      label: "Activities",
      names: ["activities"],
      Icon: SoccerBall,
    },
    {
      key: "travel",
      label: "Travel",
      names: ["travel", "places"],
      Icon: AirplaneTilt,
    },
    { key: "objects", label: "Objects", names: ["objects"], Icon: TShirt },
    { key: "symbols", label: "Symbols", names: ["symbols"], Icon: Prohibit },
    { key: "flags", label: "Flags", names: ["flags"], Icon: Flag },
  ];

  const scrollToCategory = React.useCallback(
    (names: string[]) => {
      const root = pickerRef.current;
      if (!root) return;
      // Try to find headings/labels containing these names
      const all = Array.from(
        root.querySelectorAll("h2, h3, [aria-level='2'], [aria-level='3']")
      );
      const match = all.find((el) => {
        const text = (el as HTMLElement).innerText?.trim().toLowerCase();
        if (!text) return false;
        return names.some((n) => text.includes(n.toLowerCase()));
      }) as HTMLElement | undefined;
      if (match) {
        try {
          match.scrollIntoView({ block: "start", behavior: "smooth" });
        } catch {
          match.scrollIntoView(true);
        }
        // Update active category key if we can map back
        const found = CATEGORIES.find((c) =>
          c.names.some((n) => match.innerText?.toLowerCase().includes(n))
        );
        if (found) setActiveCat(found.key);
        return;
      }
      // Fallback: search by id/data attributes that contain category keyword
      const fallback = root.querySelector(
        names
          .map((n) =>
            [
              `[id*="${n.toLowerCase()}"]`,
              `[data-category*="${n.toLowerCase()}"]`,
              `[data-name*="${n.toLowerCase()}"]`,
            ].join(",")
          )
          .join(",")
      ) as HTMLElement | null;
      if (fallback) {
        try {
          fallback.scrollIntoView({ block: "start", behavior: "smooth" });
        } catch {
          fallback.scrollIntoView(true);
        }
        const text = (fallback as HTMLElement).innerText?.toLowerCase() || "";
        const found = CATEGORIES.find((c) =>
          c.names.some((n) => text.includes(n))
        );
        if (found) setActiveCat(found.key);
      }
    },
    [CATEGORIES]
  );

  React.useEffect(() => {
    const root = pickerRef.current;
    if (!root) return;
    // Hide built-in top category nav if present
    const tablist = root.querySelector(
      "[role='tablist']"
    ) as HTMLElement | null;
    if (tablist) {
      tablist.style.display = "none";
    }
    const onClick = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const btn = (target.closest &&
        target.closest(
          "button, [role='tab'], [role='button']"
        )) as HTMLElement | null;
      if (!btn) return;
      const raw =
        btn.getAttribute("aria-label") ||
        btn.getAttribute("title") ||
        (btn.textContent || "").trim();
      if (!raw) return;
      const label = raw.toLowerCase();
      // Map common labels -> category names used in headings
      const map: Record<string, string[]> = {
        recent: ["recent"],
        "recently used": ["recent"],
        smileys: ["smileys", "people"],
        people: ["smileys", "people"],
        "smileys & people": ["smileys", "people"],
        animals: ["animals", "nature"],
        nature: ["animals", "nature"],
        "animals & nature": ["animals", "nature"],
        food: ["food", "drink"],
        drink: ["food", "drink"],
        "food & drink": ["food", "drink"],
        activities: ["activities"],
        activity: ["activities"],
        travel: ["travel", "places"],
        places: ["travel", "places"],
        "travel & places": ["travel", "places"],
        objects: ["objects"],
        symbols: ["symbols"],
        flags: ["flags"],
        flag: ["flags"],
      };
      const key = Object.keys(map).find((k) => label.includes(k));
      if (key) scrollToCategory(map[key]);
    };
    root.addEventListener("click", onClick, true);
    return () => root.removeEventListener("click", onClick, true);
  }, [scrollToCategory]);

  // Track visible section to highlight the active bottom tab
  React.useEffect(() => {
    const root = pickerRef.current;
    if (!root) return;
    const headings = Array.from(
      root.querySelectorAll("h2, h3, [aria-level='2'], [aria-level='3']")
    );
    if (!headings.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) {
          const text =
            (visible.target as HTMLElement).innerText?.toLowerCase() || "";
          const found = CATEGORIES.find((c) =>
            c.names.some((n) => text.includes(n))
          );
          if (found) setActiveCat(found.key);
        }
      },
      {
        root:
          root.querySelector("[role='grid'], .epr-body, .epr-emoji-list") ||
          root,
        threshold: [0.25, 0.5, 0.75],
      }
    );
    headings.forEach((h) => io.observe(h));
    return () => io.disconnect();
  }, [CATEGORIES, pickerRef.current]);

  return (
    <div className="flex flex-col min-h-[100dvh] bg-white pt-[calc(env(safe-area-inset-top)+56px)] pb-[env(safe-area-inset-bottom)]">
      <header className="fixed inset-x-0 top-0 z-20 flex h-14 items-center px-4 bg-white">
        <button
          onClick={() => {
            try {
              sessionStorage.removeItem("reaction:target");
            } catch {}
            close();
          }}
          aria-label="Close"
          className="text-gray-900"
        >
          <X size={20} />
        </button>
      </header>

      <div className="flex-1 min-h-0 px-2 pb-14 overflow-hidden">
        {/* Local style overrides: remove border/box-shadow and ensure internal body scrolls */}
        <style>{`
          .EmojiPickerReact { box-shadow: none !important; border: none !important; }
          .EmojiPickerReact .epr-body, .EmojiPickerReact .epr-emoji-list { overscroll-behavior: contain; }
          /* Remove focus ring on search input */
          .EmojiPickerReact .epr-search-container input,
          .EmojiPickerReact .epr-search input {
            outline: none !important;
            box-shadow: none !important;
          }
          .EmojiPickerReact .epr-search-container input:focus,
          .EmojiPickerReact .epr-search input:focus {
            outline: none !important;
            box-shadow: none !important;
            border-color: #e5e7eb !important; /* neutral border when focused */
          }
        `}</style>
        <div
          ref={pickerRef}
          className="h-full overflow-y-auto overscroll-y-contain"
          style={{
            height:
              "calc(100dvh - (56px + 56px + env(safe-area-inset-top) + env(safe-area-inset-bottom)))",
          }}
        >
          {recent.length > 0 && (
            <div className="pt-2">
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

          <EmojiPicker
            onEmojiClick={handleEmojiClick}
            autoFocusSearch={false}
            lazyLoadEmojis
            theme={Theme.LIGHT}
            width="100%"
            searchPlaceholder="Search emoji..."
          />
        </div>
      </div>

      {/* Bottom Category Nav */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 h-14 bg-white border-t border-gray-100 flex items-center justify-around px-2"
        role="navigation"
        aria-label="Emoji categories"
      >
        {CATEGORIES.map(({ key, label, names, Icon }) => {
          const active = activeCat === key;
          return (
            <button
              key={key}
              type="button"
              className={`flex flex-col items-center justify-center gap-1 text-[10px] px-2 py-1 ${
                active ? "text-blue-600" : "text-gray-600"
              }`}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              onClick={() => {
                setActiveCat(key);
                scrollToCategory(names);
              }}
            >
              <Icon size={22} />
              <span className="hidden sm:block">{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};

export default EmojiPickerPage;
