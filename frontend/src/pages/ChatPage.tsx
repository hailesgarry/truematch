import React, { useState, useEffect, useRef, useReducer } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  ArrowLeft,
  PaperPlaneTilt,
  Check,
  ArrowBendUpLeft,
  PencilSimple,
  Trash,
  Flag,
  Smiley,
  // NEW:
  At,
  Gif,
  // NEW: image icon used inside MediaUpload component, not needed here
} from "@phosphor-icons/react";
import { useAuthStore } from "../stores/authStore";
import { useGroupStore } from "../stores/groupStore";
import { useSocketStore } from "../stores/socketStore";
import { useMessageStore } from "../stores/messageStore";
import { useComposerStore } from "../stores/composerStore";
import { fetchMessagesForGroup } from "../services/api";
import type { Message } from "../types";
import BottomSheet from "../components/common/BottomSheet";
import "./ChatPage.css";
import {
  pickBubbleColor,
  DEFAULT_BUBBLE_PALETTE,
  // You can try these:
  // VIBRANT_BUBBLE_PALETTE,
  // PASTEL_BUBBLE_PALETTE,
} from "../utils/bubbles";
import MessageReactions from "../components/MessageReactions";
import ReactionDrawer from "../components/ReactionDrawer";
import { useNotificationStore } from "../stores/notificationStore";
import UserQuickActions from "../components/common/UserQuickActions";
import AutoGrowTextarea from "../components/common/AutoGrowTextarea";
import ReactionChooser from "../components/common/ReactionChooser";
import RoomMenu from "../components/common/RoomMenu"; // Add this import at the top
import SlidingHeader from "../components/common/SlidingHeader";
import MediaUpload, { MediaMessage } from "../components/common/MediaUpload";

// NEW: Large media size threshold (bytes) – used to optionally gate autoplay/loading
const LARGE_MEDIA_THRESHOLD = 6 * 1024 * 1024; // 6 MB

// Choose the active palette (from utils/bubbles)
const ACTIVE_BUBBLE_PALETTE = DEFAULT_BUBBLE_PALETTE;

type ChatMessage = Message & {
  replyTo?: {
    username: string;
    text: string;
    timestamp: number;
  };
};

const truncate = (s: string, max = 80) =>
  s.length > max ? s.slice(0, max - 1) + "…" : s;

function tokenizeMentions(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /@([A-Za-z0-9_]{1,32})/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const full = m[0];
    parts.push(
      <span key={`mention-${m.index}`} className="font-semibold text-grey-900">
        {full}
      </span>
    );
    last = m.index + full.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// --- GIF / Animated media helpers (extended for MP4/WebP inline playback) ---
const GIF_SINGLE_REGEX = /\.(gif)(\?|#|$)/i;
function isGifUrl(str: string): boolean {
  if (!/^https?:\/\//i.test(str)) return false;
  return (
    GIF_SINGLE_REGEX.test(str) ||
    /tenor\.com\/.*\.gif/i.test(str) ||
    /media\.giphy\.com\/media\//i.test(str)
  );
}

// Add a unified type for media variants (preview optional)
type AnimatedSources = {
  gif: string;
  mp4?: string;
  webm?: string;
  preview?: string;
};

// Attempt to derive mp4 / webp variants from a canonical GIF URL.
function deriveAnimatedSources(gifUrl: string): AnimatedSources | null {
  if (!isGifUrl(gifUrl)) return null;
  const queryIndex = gifUrl.indexOf("?");
  const query = queryIndex !== -1 ? gifUrl.slice(queryIndex) : "";
  const base = gifUrl.replace(/(\.gif)(\?.*)?$/i, "");
  return {
    gif: gifUrl,
    mp4: `${base}.mp4${query}`,
    webm: `${base}.webm${query}`,
    // preview is optional and omitted here
  };
}

const AnimatedMedia: React.FC<{
  url: string;
  large?: boolean;
  mediaSources?: {
    mp4?: string;
    webm?: string;
    gif?: string;
    preview?: string;
  };
}> = ({ url, large, mediaSources }) => {
  // removed unused imageReady state
  const [videoReady, setVideoReady] = React.useState(false);
  const [showVideo, setShowVideo] = React.useState(false);
  const [tooLarge, setTooLarge] = React.useState(false);
  const [checkedSize, setCheckedSize] = React.useState(false);

  // Ensure derived has a consistent shape with optional fields
  const derived: AnimatedSources | null = mediaSources
    ? {
        gif: mediaSources.gif || url,
        mp4: mediaSources.mp4,
        webm: mediaSources.webm,
        preview: mediaSources.preview,
      }
    : deriveAnimatedSources(url);

  // Fixed width classes to prevent overflow
  const widthClasses = large ? "w-70 sm:w-70 md:w-70" : "w-64 sm:w-70";

  // Remove gray background, ensure media never overflows
  const mediaClass = "rounded-md shadow-sm object-contain";
  const dimsClass = [
    mediaClass,
    widthClasses,
    "max-w-full h-auto", // <- keep within container and preserve aspect ratio
    large ? "max-h-72" : "max-h-56",
  ].join(" ");

  // Ensure the container itself also doesn’t overflow the layout
  const containerClasses = large
    ? `flex flex-col ${widthClasses} max-w-full`
    : `inline-block my-1 ${widthClasses} max-w-full`;

  React.useEffect(() => {
    let abort = false;
    (async () => {
      if (!derived?.mp4 || checkedSize) return;
      try {
        const res = await fetch(derived.mp4, { method: "HEAD" });
        const lenStr = res.headers.get("Content-Length");
        if (!abort && lenStr) {
          const size = parseInt(lenStr, 10);
          if (size && size > LARGE_MEDIA_THRESHOLD) {
            // Gate only the video; the image will still be shown
            setTooLarge(true);
          }
        }
      } catch {
        // ignore
      } finally {
        if (!abort) setCheckedSize(true);
      }
    })();
    return () => {
      abort = true;
    };
  }, [derived?.mp4, checkedSize]);

  // When the video can play and it's not gated, switch to it
  React.useEffect(() => {
    if (videoReady && !tooLarge) {
      setShowVideo(true);
    }
  }, [videoReady, tooLarge]);

  // Non-GIF: just show image
  if (!derived) {
    return (
      <img
        src={url}
        alt="GIF"
        loading="lazy"
        className={dimsClass}
        draggable={false}
      />
    );
  }

  const stillSrc = derived?.preview || derived.gif || url;

  return (
    <div className={containerClasses}>
      {/* Show still image immediately */}
      <img
        src={stillSrc}
        alt="GIF"
        className={`${dimsClass} ${showVideo && videoReady ? "hidden" : ""}`}
        loading="lazy"
        draggable={false}
      />

      {/* Video preloads in background; hidden until ready. If gated by size, wait for user to click Load. */}
      {(!tooLarge || showVideo) && (
        <video
          className={`${dimsClass} ${showVideo && videoReady ? "" : "hidden"}`}
          autoPlay
          loop
          muted
          playsInline
          controls={false}
          onCanPlay={() => setVideoReady(true)}
          onError={() => {
            // Stay on the still image if playback fails
            setVideoReady(false);
            setShowVideo(false);
          }}
        >
          {derived.mp4 && <source src={derived.mp4} type="video/mp4" />}
          {derived.webm && <source src={derived.webm} type="video/webm" />}
        </video>
      )}

      {/* Large-media gate: keep image, allow enabling video on demand */}
      {tooLarge && !showVideo && (
        <div className="mt-2 flex items-center gap-2">
          <div className="text-xs text-gray-600">
            Large media (~&gt;{(LARGE_MEDIA_THRESHOLD / 1024 / 1024).toFixed(0)}
            MB). Load anyway?
          </div>
          <button
            type="button"
            onClick={() => setShowVideo(true)}
            className="px-3 py-1.5 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700"
          >
            Load
          </button>
        </div>
      )}
    </div>
  );
};

// Updated tokenizer to embed playable media
function tokenizeTextWithGifs(text: string): React.ReactNode[] {
  const segments = text.split(/(\s+)/);
  return segments.map((seg, i) => {
    if (isGifUrl(seg)) {
      return <AnimatedMedia key={`gif-${i}`} url={seg} />;
    }
    if (/@/.test(seg)) {
      return (
        <React.Fragment key={`t-${i}`}>{tokenizeMentions(seg)}</React.Fragment>
      );
    }
    return <React.Fragment key={`t-${i}`}>{seg}</React.Fragment>;
  });
}

// NEW: helper to detect if a message is GIF-only (structured gif or single GIF URL)
function isGifOnlyMessage(m: Message): boolean {
  const structuredGif = (m as any).kind === "gif" && (m as any).media;
  const trimmed = (m.text || "").trim();
  const singleGifUrl = !!trimmed && isGifUrl(trimmed) && !trimmed.includes(" ");
  return !!structuredGif || !!singleGifUrl;
}

// Add helpers near other helpers
function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url);
}
// removed unused isImageUrl helper

import RelativeTime from "../components/common/RelativeTime";

// --- end GIF helpers (extended) ---

const ChatPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { username, joined } = useAuthStore();
  // removed unused myUserId
  const { currentGroup, onlineUsers, setCurrentGroup } = useGroupStore();
  const {
    isConnected,
    ensureConnected,
    joinGroup,
    leaveGroup,
    // sendMessage removed (we call via getState())
    joinedGroupIds,
    activeGroupId,
    setActiveGroup,
  } = useSocketStore();
  // removed unused reactToMessage getter
  const { messages, setMessages } = useMessageStore(); // removed replyTo / setReplyTo
  const {
    draft: messageInput,
    setDraft: setMessageInput,
    resetDraft,
    setCursorPos,
    cursorPos,
    replyTarget,
    setReplyTarget,
    clearReplyTarget,
    // NEW:
    shouldFocus,
    consumeFocus,
    setScope,
  } = useComposerStore();

  // removed groupInfo state (header description no longer used)
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false); // NEW: Group menu state

  // NEW: Reactions Drawer state
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [reactionsMessage, setReactionsMessage] = useState<Message | null>(
    null
  );

  // REMOVE: editingMessage state (handled by union)
  // const [editingMessage, setEditingMessage] = useState<Message | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Add back the end-of-list anchor ref
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Track the last "my message" we've seen to avoid scrolling on mount/group switch
  const myLastKeyRef = useRef<string | number | null>(null);
  const isExplicitLeave = useRef(false);
  const triedFallback = useRef(false);
  const menuRef = useRef<HTMLDivElement | null>(null); // NEW: Menu ref
  const listRef = useRef<HTMLDivElement>(null); // NEW: List ref
  const scrollRef = useRef<HTMLDivElement>(null); // NEW: Scroll container ref

  // NEW: refs map for each message row + highlighted key
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Ensure composer state is scoped per room to avoid bleed into DMs or other rooms
  useEffect(() => {
    if (currentGroup) {
      setScope(`group:${currentGroup.id}`);
    } else {
      setScope("group:");
    }
  }, [currentGroup?.id]);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);

  // Header hide/show behavior handled by SlidingHeader

  // Cache computed colors per username (avoids re-hashing repeatedly)
  const colorCache = useRef<Record<string, string>>({});

  // replace the current getColorForMessage with this version
  function getColorForMessage(m: Message): { bg: string; fg: string } {
    const chosen = m.bubbleColor;

    const base =
      chosen && /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.test(chosen)
        ? chosen
        : colorCache.current[m.username] ??
          (colorCache.current[m.username] = pickBubbleColor(
            m.username,
            ACTIVE_BUBBLE_PALETTE
          ));

    // Current behavior (dark text). For automatic contrast, switch to the second line.
    const fg = "#111827";
    // const fg = needsLightText(base) ? "#ffffff" : "#111827";

    return { bg: base, fg };
  }

  // Guard
  useEffect(() => {
    if (!joined) {
      navigate("/", { replace: true });
      return;
    }
    if (!currentGroup) {
      navigate("/groups", { replace: true });
      return;
    }

    ensureConnected();

    return () => {
      if (currentGroup && isExplicitLeave.current) {
        leaveGroup(currentGroup.id);
        isExplicitLeave.current = false;
      }
    };
  }, [joined, currentGroup, navigate, ensureConnected, leaveGroup]);

  // Join & activate on connect / group change
  useEffect(() => {
    if (!currentGroup) return;
    if (!isConnected) return;
    joinGroup(currentGroup.id, currentGroup.name);
    setActiveGroup(currentGroup.id);
  }, [isConnected, currentGroup, joinGroup, setActiveGroup]);

  // Refresh user list if reconnected
  useEffect(() => {
    if (isConnected && currentGroup && joinedGroupIds.has(currentGroup.id)) {
      joinGroup(currentGroup.id, currentGroup.name);
    }
  }, [isConnected, currentGroup, joinedGroupIds, joinGroup]);

  // Fallback REST fetch
  useEffect(() => {
    if (!currentGroup) return;
    const existing = messages[currentGroup.id] || [];
    if (!isConnected) return;
    if (existing.length > 0) return;
    if (triedFallback.current) return;

    const t = setTimeout(async () => {
      const stillEmpty = (messages[currentGroup.id] || []).length === 0;
      if (stillEmpty) {
        try {
          const remote = await fetchMessagesForGroup(currentGroup.id);
          setMessages(currentGroup.id, remote);
        } catch (e) {
          console.error("Fallback fetch failed:", e);
        }
      }
      triedFallback.current = true;
    }, 600);

    return () => clearTimeout(t);
  }, [isConnected, currentGroup, messages, setMessages]);

  // REMOVE this effect to disable all auto-scroll
  // useEffect(() => {
  //   messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  // }, [messages, currentGroup?.id]);

  const currentMessages = currentGroup ? messages[currentGroup.id] || [] : [];

  // -------------------------
  // Unified UI state machine
  // -------------------------
  type UIState =
    | { kind: "idle" }
    | { kind: "sheet-actions"; message: Message }
    | { kind: "sheet-confirm-delete"; message: Message }
    | { kind: "editing"; message: Message };

  type UIAction =
    | { type: "OPEN_ACTIONS"; message: Message }
    | { type: "OPEN_CONFIRM_DELETE" }
    | { type: "CLOSE_SHEET" }
    | { type: "START_EDIT"; message: Message }
    | { type: "CANCEL_EDIT" }
    | { type: "RESET" };

  function uiReducer(state: UIState, action: UIAction): UIState {
    switch (action.type) {
      case "OPEN_ACTIONS":
        return { kind: "sheet-actions", message: action.message };
      case "OPEN_CONFIRM_DELETE":
        return state.kind === "sheet-actions"
          ? { kind: "sheet-confirm-delete", message: state.message }
          : state;
      case "CLOSE_SHEET":
        if (state.kind.startsWith("sheet-")) return { kind: "idle" };
        return state;
      case "START_EDIT":
        return { kind: "editing", message: action.message };
      case "CANCEL_EDIT":
        return state.kind === "editing" ? { kind: "idle" } : state;
      case "RESET":
        return { kind: "idle" };
      default:
        return state;
    }
  }

  const [uiState, dispatchUI] = useReducer(uiReducer, { kind: "idle" });

  // Derived helpers
  const sheetOpen =
    uiState.kind === "sheet-actions" || uiState.kind === "sheet-confirm-delete";
  const sheetMessage =
    uiState.kind === "sheet-actions" || uiState.kind === "sheet-confirm-delete"
      ? uiState.message
      : null;
  const editingMessage = uiState.kind === "editing" ? uiState.message : null;

  // Get pending sets from socket store
  const { pendingEdits, pendingDeletes } = useSocketStore();

  const keyFor = (m: any) =>
    m?.messageId ? `id:${m.messageId}` : `ts:${m?.username}|${m?.timestamp}`;

  // removed unused sheetMsgKey

  // NEW: block editing for GIF-only or emoji-only messages
  const editKindBlocked =
    !!sheetMessage &&
    (isGifOnlyMessage(sheetMessage) || isEmojiOnly(sheetMessage.text));

  // UPDATED: include kind-based block in editDisabled
  const editDisabled =
    !!sheetMessage &&
    (editKindBlocked ||
      pendingEdits.has(`id:${sheetMessage.messageId}`) ||
      pendingEdits.has(
        `ts:${sheetMessage.username}|${sheetMessage.timestamp}`
      ) ||
      pendingDeletes.has(`id:${sheetMessage.messageId}`) ||
      pendingDeletes.has(
        `ts:${sheetMessage.username}|${sheetMessage.timestamp}`
      ));

  const deleteDisabled =
    !!sheetMessage &&
    (pendingDeletes.has(`id:${sheetMessage.messageId}`) ||
      pendingDeletes.has(
        `ts:${sheetMessage.username}|${sheetMessage.timestamp}`
      ));

  // -------------------------
  // Existing effects unchanged (except remove setReplyTo uses)
  // -------------------------

  // Auto-close sheet or cancel edit/reply if the underlying message got deleted or disappeared
  useEffect(() => {
    if (!currentGroup) return;
    const list = currentGroup ? messages[currentGroup.id] || [] : [];
    const findMessage = (msg: Message | null) => {
      if (!msg) return null;
      if (msg.messageId)
        return list.find((m: any) => m.messageId === msg.messageId) || null;
      return (
        list.find(
          (m) => m.timestamp === msg.timestamp && m.username === msg.username
        ) || null
      );
    };

    // Sheet states
    if (sheetMessage) {
      const live = findMessage(sheetMessage);
      if (!live || (live as any).deleted) {
        dispatchUI({ type: "CLOSE_SHEET" });
      }
    }
    // Editing state
    if (editingMessage) {
      const live = findMessage(editingMessage);
      if (!live || (live as any).deleted) {
        dispatchUI({ type: "CANCEL_EDIT" });
        resetDraft();
      }
    }
  }, [messages, currentGroup, sheetMessage, editingMessage]);

  // Navigation / room management handlers (restored)
  const handleBack = () => {
    const from = (location.state as any)?.from as string | undefined;
    if (from === "/inbox") {
      navigate("/inbox");
      return;
    }
    if (from === "/groups") {
      navigate("/groups");
      return;
    }
    // Fallback to history when available, else groups
    try {
      if (
        typeof window !== "undefined" &&
        window.history &&
        window.history.length > 1
      ) {
        navigate(-1);
        return;
      }
    } catch {}
    navigate("/groups");
  };

  const handleLeaveRoom = () => {
    if (currentGroup) {
      isExplicitLeave.current = true;
      leaveGroup(currentGroup.id);
      setCurrentGroup(null);
      navigate("/groups", { replace: true });
    }
  };

  // -------------------------
  // Handlers (updated)
  // -------------------------
  const openActionsFor = (m: Message) => {
    dispatchUI({ type: "OPEN_ACTIONS", message: m });
  };

  // Provide unified handlers: long-press on touch and right-click on desktop
  const buildPressHandlers = (trigger: () => void) => {
    let timer: number | null = null;
    let fired = false;
    let suppressClick = false;
    const PRESS_MS = 500;
    const clear = () => {
      if (timer != null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };
    return {
      onTouchStart: () => {
        fired = false;
        suppressClick = false;
        clear();
        timer = window.setTimeout(() => {
          fired = true;
          trigger();
        }, PRESS_MS) as unknown as number;
      },
      onTouchMove: () => {
        clear();
      },
      onTouchEnd: () => {
        if (timer != null) clear();
        if (fired) {
          // prevent synthetic click after long press
          suppressClick = true;
          window.setTimeout(() => (suppressClick = false), 300);
        }
      },
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        trigger();
      },
      onClick: (e: React.MouseEvent) => {
        if (suppressClick || fired) {
          e.preventDefault();
          e.stopPropagation();
          fired = false;
          suppressClick = false;
          return;
        }
        trigger();
      },
    } as React.HTMLAttributes<HTMLElement>;
  };

  const closeSheet = () => dispatchUI({ type: "CLOSE_SHEET" });

  const handleDelete = () => {
    if (!sheetMessage || sheetMessage.username !== username) {
      closeSheet();
      return;
    }
    dispatchUI({ type: "OPEN_CONFIRM_DELETE" });
  };

  const handleReply = () => {
    if (sheetMessage) {
      setReplyTarget(sheetMessage);
      // Focus the composer after closing the sheet; defer so BottomSheet can animate out
      setTimeout(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          try {
            const pos = el.value.length;
            el.setSelectionRange(pos, pos);
          } catch {
            // ignore selection errors
          }
        }
      }, 50);
    }
    closeSheet();
  };

  // NEW: Mention handler — inserts "@username " at the caret and focuses input
  const handleMention = () => {
    if (!sheetMessage) {
      closeSheet();
      return;
    }
    const target = sheetMessage.username?.trim();
    if (!target) {
      closeSheet();
      return;
    }

    const current = messageInput || "";
    // Use stored cursorPos when available; otherwise append at end
    let caret = typeof cursorPos === "number" ? cursorPos : current.length;
    caret = Math.max(0, Math.min(current.length, caret));

    const before = current.slice(0, caret);
    const after = current.slice(caret);

    // Add a leading space if needed and always include a trailing space after the mention
    const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
    const insertion = `${needsLeadingSpace ? " " : ""}@${target} `;
    const nextVal = before + insertion + after;
    const nextCaret = before.length + insertion.length;

    // Update composer value and caret
    setMessageInput(nextVal, nextCaret);

    // Focus after the sheet closes
    setTimeout(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        try {
          el.setSelectionRange(nextCaret, nextCaret);
        } catch {
          // ignore selection errors
        }
      }
    }, 50);

    closeSheet();
  };

  const handleEdit = () => {
    if (sheetMessage) {
      // Guard: disallow editing GIF-only or emoji-only messages
      if (isGifOnlyMessage(sheetMessage) || isEmojiOnly(sheetMessage.text)) {
        closeSheet();
        return;
      }
      dispatchUI({ type: "START_EDIT", message: sheetMessage });
      setMessageInput(sheetMessage.text, sheetMessage.text.length);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
    closeSheet();
  };

  const confirmDelete = () => {
    if (sheetMessage) {
      useSocketStore.getState().deleteMessage(sheetMessage);
    }
    closeSheet();
  };

  const cancelDeleteConfirmation = () => {
    if (sheetMessage) {
      dispatchUI({ type: "OPEN_ACTIONS", message: sheetMessage });
    } else {
      dispatchUI({ type: "CLOSE_SHEET" });
    }
  };

  const cancelEditing = () => {
    if (editingMessage) {
      dispatchUI({ type: "CANCEL_EDIT" });
      resetDraft();
    }
  };

  const cancelReplying = () => {
    clearReplyTarget();
  };

  const handleSendMessage = () => {
    if (mentionOpen && mentionCandidates.length > 0) {
      insertMention(mentionCandidates[mentionIndex]);
      return;
    }
    if (!messageInput.trim()) return;

    if (editingMessage) {
      useSocketStore.getState().editMessage(editingMessage, messageInput);
      dispatchUI({ type: "CANCEL_EDIT" });
      resetDraft();
      return;
    } else {
      useSocketStore.getState().sendMessage(messageInput, replyTarget || null, {
        kind: "text",
      });
      resetDraft();
      if (replyTarget) clearReplyTarget();
    }
  };

  // Keyboard Esc handling inside input
  // (Update onKeyDown below accordingly)

  // -------------------------
  // JSX Adjustments:
  // - Replace editingMessage / replyTo logic with editingMessage & replyTarget
  // - Sheet uses sheetMessage and uiState.kind
  // - Disable Edit/Delete buttons if pending
  // -------------------------

  const mentionCandidates = React.useMemo(() => {
    if (!mentionOpen) return [];
    const q = mentionQuery.toLowerCase();
    const base = onlineUsers
      .map((u: any) => u.username)
      .filter((u) => u && u !== username); // exclude current user
    const uniq = Array.from(new Set(base));
    return uniq.filter((u) => u.toLowerCase().startsWith(q)).slice(0, 8);
  }, [mentionOpen, mentionQuery, onlineUsers, username]);

  useEffect(() => {
    if (mentionIndex >= mentionCandidates.length) setMentionIndex(0);
  }, [mentionCandidates, mentionIndex]);

  function detectMention(value: string, caret: number) {
    let i = caret - 1;
    while (i >= 0) {
      const ch = value[i];
      if (ch === " " || ch === "\n" || ch === "\t") break;
      i--;
    }
    const start = i + 1;
    const token = value.slice(start, caret);
    if (token.startsWith("@")) return { token, start, end: caret };
    return null;
  }

  function insertMention(name: string) {
    if (!inputRef.current) return;
    const el = inputRef.current;
    const value = el.value;
    const caret = el.selectionStart || 0;
    const info = detectMention(value, caret);
    if (!info) return;
    const before = value.slice(0, info.start);
    const after = value.slice(info.end);
    const nextVal = `${before}@${name} ${after}`;
    setMessageInput(nextVal);
    const newCaret = before.length + name.length + 2;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(newCaret, newCaret);
    });
    setMentionOpen(false);
    setMentionQuery("");
    setMentionIndex(0);
  }

  // (Add this effect inside the component, e.g., after other useEffects)
  useEffect(() => {
    if (!groupMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setGroupMenuOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setGroupMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [groupMenuOpen]);

  // (Add this helper variable somewhere near other derived values, before the return)
  const groupInitials = React.useMemo(
    () =>
      currentGroup?.name
        ?.split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase() || "",
    [currentGroup?.name]
  );

  // Reset unread for current group when viewing chat
  useEffect(() => {
    if (!currentGroup) return;
    // Only reset on chat route
    const isChatRoute =
      typeof window !== "undefined" && window.location?.pathname === "/chat";
    if (!isChatRoute) return;

    const resetForCurrent = () => {
      try {
        useNotificationStore.getState().reset(currentGroup.id);
      } catch {}
    };

    resetForCurrent();

    // Also reset on visibility change (coming back to tab)
    const onVis = () => {
      if (document.visibilityState === "visible") resetForCurrent();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [currentGroup?.id]);

  // Removed header description (no longer shown in header)

  // Members count removed from RoomMenu; no need to compute here

  useEffect(() => {
    if (!shouldFocus) return;
    const el = inputRef.current;
    if (el) {
      el.focus();
      try {
        const pos = typeof cursorPos === "number" ? cursorPos : el.value.length;
        el.setSelectionRange(pos, pos);
      } catch {
        // ignore selection errors
      }
    }
    consumeFocus();
  }, [shouldFocus, consumeFocus, cursorPos]);

  // Keep a tiny ref for potential future use; used below in group-change effect
  const prevCountRef = useRef(0);

  // Only jump on group change (initial view). We no longer auto-scroll on other users.
  useEffect(() => {
    prevCountRef.current = 0;
    requestAnimationFrame(() =>
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" })
    );
  }, [currentGroup?.id]);

  // INSERT 1: compute the latest message authored by the current user
  // Place this after `const currentMessages = ...`
  const myLatestMsgKey = React.useMemo(() => {
    const list = currentMessages;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (m.username === username && !(m as any).deleted) {
        return m.messageId
          ? `id:${m.messageId}`
          : `ts:${m.username}|${m.timestamp}`;
      }
    }
    return null as string | null;
  }, [currentMessages, username]);

  // INSERT 2: when your own latest message changes, scroll to bottom
  // Place this near your other useEffects (e.g., after the near-bottom effect)
  useEffect(() => {
    if (!myLatestMsgKey) return;
    if (myLastKeyRef.current !== myLatestMsgKey) {
      myLastKeyRef.current = myLatestMsgKey;
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [myLatestMsgKey]);

  // NEW: scroll-to-referenced helper (for reply previews)
  const scrollToReferenced = React.useCallback(
    (reply: { username: string; timestamp: number }) => {
      if (!currentGroup) return;
      const list = messages[currentGroup.id] || [];

      // Coercion helpers
      const toNum = (ts: unknown) => (typeof ts === "number" ? ts : Number(ts));
      const replyTsNum = toNum((reply as any).timestamp);
      const replyTsStr = String((reply as any).timestamp);

      const target =
        list.find((mm: any) => {
          // Try numeric compare first
          const mmTsNum = toNum(mm.timestamp);
          if (Number.isFinite(replyTsNum) && Number.isFinite(mmTsNum)) {
            if (mm.username === reply.username && mmTsNum === replyTsNum)
              return true;
          }
          // Fallback to string compare to cover non-numeric values
          return (
            mm.username === reply.username &&
            String(mm.timestamp) === replyTsStr
          );
        }) || null;

      if (!target) return;

      const k = (target as any).messageId
        ? `id:${(target as any).messageId}`
        : `ts:${target.username}|${target.timestamp}`;

      const el = messageRefs.current.get(k);
      const doScroll = (node: HTMLDivElement | undefined) => {
        if (!node) return;
        node.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlightedKey(k);
        window.setTimeout(() => setHighlightedKey(null), 1600);
      };

      if (el) {
        doScroll(el);
      } else {
        requestAnimationFrame(() => doScroll(messageRefs.current.get(k)));
      }
    },
    [currentGroup, messages]
  );

  return (
    <div className="flex flex-col h-screen">
      <SlidingHeader
        scrollRef={scrollRef}
        className="bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/70"
        innerClassName="chat-header-content justify-between px-3 h-14 border-b"
        springConfig={{ stiffness: 560, damping: 36 }}
      >
        <div className="flex items-center gap-4 min-w-0">
          <button
            onClick={handleBack}
            className="text-gray-900"
            aria-label="Back to groups"
          >
            <ArrowLeft size={24} />
          </button>

          <div className="flex items-center gap-2 min-w-0">
            <div className="group-thumb">
              {currentGroup?.avatarUrl ? (
                <img
                  src={currentGroup.avatarUrl}
                  alt={`${currentGroup.name} avatar`}
                  className="group-thumb-img"
                />
              ) : (
                <div className="group-thumb-fallback">{groupInitials}</div>
              )}
            </div>

            <div className="chat-header-info">
              <h1 className="text-message font-semibold text-gray-900 flex items-center gap-2">
                {currentGroup?.name}
                {activeGroupId &&
                  currentGroup &&
                  activeGroupId !== currentGroup.id && (
                    <span className="text-xs font-medium text-blue-600">
                      viewing inactive
                    </span>
                  )}
              </h1>
            </div>
          </div>
        </div>

        {/* Right-side actions: Menu (Share moved into RoomMenu) */}
        <div className="flex items-center gap-4">
          <RoomMenu
            onLeaveRoom={handleLeaveRoom}
            buttonClassName="text-gray-900"
            groupId={currentGroup?.id}
            groupName={currentGroup?.name}
          />
        </div>
      </SlidingHeader>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto pt-14 sm:pt-16" ref={scrollRef}>
        <div ref={listRef} className="flex flex-col min-h-full px-4 pt-4">
          {/* Spacer pushes the message list to the bottom so extra space is at the top */}
          <div className="grow" aria-hidden="true" />
          {currentMessages.map((m: Message) => {
            // NEW: system message early render
            if ((m as any).system || m.username === "_system") {
              return (
                <div
                  key={m.messageId || m.timestamp}
                  className="mb-3 flex justify-center"
                >
                  <div className="text-[11px] tracking-wide  text-gray-500 select-none">
                    {m.text}
                  </div>
                </div>
              );
            }

            // Compute once and reuse inside the content block
            const colors = getColorForMessage(m);
            const msgKey = keyFor(m); // NEW: compute key once
            const isStandaloneStructuredMedia =
              (m as any).kind === "media" &&
              (m as any).media &&
              (m as any).media.original &&
              !(m as any).replyTo;

            return (
              <div
                key={msgKey}
                ref={(el) => {
                  if (el) messageRefs.current.set(msgKey, el);
                  else messageRefs.current.delete(msgKey);
                }}
                className={`mb-2 ${
                  highlightedKey === msgKey
                    ? // Pull to page edges, add inner padding, and make it more visible
                      "-mx-4 px-4 py-1 bg-gray-200 transition-colors"
                    : ""
                }`}
              >
                {/* Row 1: avatar + bubble */}
                <div
                  className={`flex ${
                    m.username === username ? "justify-end" : ""
                  }`}
                >
                  {m.username !== username && (
                    <div className="flex-shrink-0 mr-2 self-end">
                      {m.avatar ? (
                        <img
                          src={m.avatar}
                          alt={`${m.username}'s avatar`}
                          className="w-8 h-8 rounded-full"
                        />
                      ) : (
                        <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center text-gray-600 text-xs font-bold">
                          {m.username[0].toUpperCase()}
                        </div>
                      )}
                    </div>
                  )}

                  <div
                    className={`flex flex-col ${
                      isStandaloneStructuredMedia
                        ? "max-w-full w-full"
                        : "max-w-[75%]"
                    } ${m.username === username ? "items-end" : "items-start"}`}
                  >
                    {/* Username + timestamp */}
                    <div
                      className={`flex items-center text-xs mb-1 ${
                        m.username === username
                          ? "justify-end"
                          : "justify-start"
                      }`}
                    >
                      {m.username === username ? (
                        <span className="font-medium">You</span>
                      ) : (
                        <UserQuickActions
                          username={m.username}
                          avatarUrl={m.avatar ?? undefined}
                        >
                          <span className="text-sm font-medium cursor-pointer">
                            {m.username}
                          </span>
                        </UserQuickActions>
                      )}
                      <RelativeTime
                        value={(m as any).timestamp}
                        className="ml-2 text-[11px] text-gray-500"
                        withSuffix={false}
                        minUnit="minute"
                        hideBelowMin={false}
                        showJustNowBelowMin={true}
                        justNowThresholdMs={60_000}
                        fallback=""
                      />
                      {(m as any).edited && (
                        <span
                          className="ml-1 text-[10px] italic opacity-70"
                          title={
                            (m as any).lastEditedAt
                              ? `Edited at ${new Date(
                                  (m as any).lastEditedAt
                                ).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}`
                              : "Edited"
                          }
                        >
                          (edited)
                        </span>
                      )}
                    </div>

                    {/* Content (bubble OR standalone) */}
                    {(() => {
                      const chatMsg = m as ChatMessage;
                      const isDeleted = (m as any).deleted;
                      const structuredGif =
                        (m as any).kind === "gif" && (m as any).media;
                      const trimmed = (m.text || "").trim();
                      const singleGifUrl =
                        trimmed && isGifUrl(trimmed) && !trimmed.includes(" ");
                      const emojiOnly = isEmojiOnly(m.text);
                      const { bg, fg } = colors;

                      // Make the existing inline reply preview clickable without changing its look
                      const replyPreview =
                        chatMsg.replyTo &&
                        (() => {
                          const reply = chatMsg.replyTo;
                          const replyText = reply.text || "";
                          const replyTrimmed = replyText.trim();
                          const replyIsGifUrl =
                            isGifUrl(replyTrimmed) &&
                            !replyTrimmed.includes(" ");
                          const replyIsEmoji = isEmojiOnly(replyText);
                          const replyStructuredGif =
                            (reply as any).kind === "gif" &&
                            (reply as any).media;

                          return (
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation();
                                scrollToReferenced({
                                  username: reply.username,
                                  timestamp: reply.timestamp,
                                });
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  scrollToReferenced({
                                    username: reply.username,
                                    timestamp: reply.timestamp,
                                  });
                                }
                              }}
                              className="text-sm mb-1 px-2 py-1 rounded-md opacity-90 text-gray-700 cursor-pointer hover:opacity-100 focus:outline-none"
                              style={{
                                background:
                                  fg === "#ffffff"
                                    ? "rgba(255,255,255,0.18)"
                                    : "rgba(0,0,0,0.08)",
                              }}
                            >
                              {/* Username on its own line, no colon */}
                              <div className="font-medium text-grey-900 leading-tight">
                                {reply.username === username
                                  ? "You"
                                  : reply.username}
                              </div>

                              {/* Preview content on the next line */}
                              <div>
                                {(() => {
                                  const replyStructuredMedia =
                                    (reply as any).kind === "media" &&
                                    (reply as any).media;
                                  if (replyStructuredMedia) {
                                    const media = (reply as any).media;
                                    const src =
                                      media.preview || media.original || "";
                                    const isVid = isVideoUrl(
                                      media.original || ""
                                    );
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

                                  if (replyStructuredGif) {
                                    return (
                                      <span className="inline-block max-w-[60px] max-h-[60px]">
                                        <AnimatedMedia
                                          url={
                                            (reply as any).media.original ||
                                            (reply as any).media.gif ||
                                            replyText
                                          }
                                          mediaSources={{
                                            mp4: (reply as any).media.mp4,
                                            webm: (reply as any).media.webm,
                                            gif:
                                              (reply as any).media.gif ||
                                              replyText,
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
                                    return (
                                      <span className="text-2xl">
                                        {replyText}
                                      </span>
                                    );
                                  }

                                  return <span>{truncate(replyText, 60)}</span>;
                                })()}
                              </div>
                            </div>
                          );
                        })();

                      // Deleted stays inside a faded bubble
                      if (isDeleted) {
                        return (
                          <div
                            className="py-2 px-2.5 rounded-[20px] break-words opacity-60 cursor-default"
                            style={{ backgroundColor: bg, color: fg }}
                          >
                            <div className="italic text-sm select-none">
                              This message was deleted
                            </div>
                          </div>
                        );
                      }

                      // Standalone structured GIF (kind: 'gif')
                      if (structuredGif) {
                        const media = (m as any).media;
                        const origin = media.original || media.gif || m.text;

                        const mediaEl = (
                          <AnimatedMedia
                            url={origin}
                            large
                            mediaSources={{
                              mp4: media.mp4,
                              webm: media.webm,
                              gif: media.gif || origin,
                            }}
                          />
                        );

                        // If this message is a reply, keep it inside a bubble
                        if (chatMsg.replyTo) {
                          return (
                            <div
                              className="py-2 px-2.5 rounded-[20px] break-words transition cursor-pointer active:opacity-80"
                              style={{ backgroundColor: bg, color: fg }}
                              {...buildPressHandlers(() => openActionsFor(m))}
                            >
                              {replyPreview}
                              {mediaEl}
                            </div>
                          );
                        }

                        // Non-reply: render outside bubble
                        return (
                          <div
                            className="flex flex-col gap-1 cursor-pointer active:opacity-80"
                            {...buildPressHandlers(() => openActionsFor(m))}
                          >
                            {mediaEl}
                          </div>
                        );
                      }

                      // Single GIF URL only: outside bubble unless it's a reply
                      if (singleGifUrl) {
                        if (chatMsg.replyTo) {
                          return (
                            <div
                              className="py-2 px-2.5 rounded-[20px] break-words transition cursor-pointer active:opacity-80"
                              style={{ backgroundColor: bg, color: fg }}
                              {...buildPressHandlers(() => openActionsFor(m))}
                            >
                              {replyPreview}
                              <AnimatedMedia url={trimmed} large />
                            </div>
                          );
                        }
                        return (
                          <div
                            className="flex flex-col gap-1 cursor-pointer active:opacity-80"
                            {...buildPressHandlers(() => openActionsFor(m))}
                          >
                            <AnimatedMedia url={trimmed} large />
                          </div>
                        );
                      }

                      // Emoji-only: outside bubble unless it's a reply
                      if (emojiOnly) {
                        if (chatMsg.replyTo) {
                          return (
                            <div
                              className="py-2 px-2.5 rounded-[20px] break-words transition cursor-pointer active:opacity-80"
                              style={{ backgroundColor: bg, color: fg }}
                              {...buildPressHandlers(() => openActionsFor(m))}
                            >
                              {replyPreview}
                              <div className="text-4xl sm:text-5xl leading-none">
                                {m.text}
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div
                            className="flex flex-col gap-1 cursor-pointer select-text"
                            {...buildPressHandlers(() => openActionsFor(m))}
                          >
                            <div className="text-4xl sm:text-5xl leading-none">
                              {m.text}
                            </div>
                          </div>
                        );
                      }

                      // NEW: handle structured media (images/videos)
                      const structuredMedia =
                        (m as any).kind === "media" &&
                        (m as any).media &&
                        (m as any).media.original;

                      if (structuredMedia) {
                        const media = (m as any).media;

                        if (chatMsg.replyTo) {
                          // Keep inside a bubble when replying
                          return (
                            <div
                              className="py-2 px-2.5 rounded-[20px] break-words transition"
                              style={{ backgroundColor: bg, color: fg }}
                            >
                              {replyPreview}
                              <MediaMessage
                                media={media}
                                replyMode
                                onLongPress={() => openActionsFor(m)}
                              />
                            </div>
                          );
                        }

                        // Non-reply: standalone visual
                        return (
                          <MediaMessage
                            media={media}
                            onLongPress={() => openActionsFor(m)}
                          />
                        );
                      }

                      // Default: regular bubble (text / mixed content with inline gifs)
                      return (
                        <div
                          className="py-1.5 px-2.5 rounded-[20px] break-words transition cursor-pointer active:opacity-80 leading-tight"
                          style={{ backgroundColor: bg, color: fg }}
                          {...buildPressHandlers(() => openActionsFor(m))}
                        >
                          {replyPreview}
                          <div className="break-words whitespace-pre-line leading-tight text-message">
                            {tokenizeTextWithGifs((m.text || "").trim())}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Row 2: reactions under the bubble, indented to bubble start (not avatar) */}
                <div className="flex">
                  {/* Spacer matches avatar width (w-8) + its mr-2 = w-10 (2.5rem) */}
                  {m.username !== username && (
                    <div className="w-10 flex-shrink-0" aria-hidden="true" />
                  )}
                  <div
                    className={`flex-1 flex ${
                      m.username === username ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div className="max-w-[75%]">
                      {!(m as any).deleted && (
                        <MessageReactions
                          groupId={currentGroup!.id}
                          message={m}
                          currentUser={username}
                          align={m.username === username ? "right" : "left"}
                          hidePicker
                          onCountClick={(msg) => {
                            setReactionsMessage(msg);
                            setReactionsOpen(true);
                          }}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {isConnected && currentGroup && currentMessages.length === 0 && (
            <div className="text-center text-gray-400 text-sm py-6">
              No messages yet.
            </div>
          )}
          {!isConnected && (
            <div className="text-center text-gray-400 text-sm py-6">
              Reconnecting…
            </div>
          )}
          {/* Anchor at the absolute bottom of the scroll stack */}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input + Reply / Edit Preview */}
      <div className="px-4 py-3">
        {editingMessage && (
          <div className="mb-3 px-3 py-2 rounded-md bg-gray-100 relative flex flex-col gap-1">
            <div className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">
              Editing your message
            </div>
            <div className="text-sm text-gray-700 break-words flex items-center gap-2 min-w-0">
              {(() => {
                const text = editingMessage.text || "";
                const trimmed = text.trim();
                const structuredGif =
                  (editingMessage as any).kind === "gif" &&
                  (editingMessage as any).media;

                if (structuredGif) {
                  const media = (editingMessage as any).media;
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

                const singleGifUrl =
                  trimmed && isGifUrl(trimmed) && !trimmed.includes(" ");
                if (singleGifUrl) {
                  return (
                    <span className="inline-block max-w-[60px] max-h-[60px]">
                      <AnimatedMedia url={trimmed} />
                    </span>
                  );
                }

                if (isEmojiOnly(text)) {
                  return <span className="text-2xl">{text}</span>;
                }

                return (
                  <span className="flex-1 min-w-0 overflow-hidden line-clamp-2">
                    {text}
                  </span>
                );
              })()}
            </div>
            <button
              type="button"
              onClick={cancelEditing}
              className="absolute top-1.5 right-1.5 text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring focus-visible:ring-blue-500 rounded"
              aria-label="Cancel edit"
              title="Cancel edit"
            >
              {/* X icon */}
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
        )}

        {!editingMessage && replyTarget && (
          // Stack label over content
          <div className="mb-3 px-3 py-2 rounded-md bg-gray-100 relative flex flex-col gap-1">
            <div className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">
              Replying to{" "}
              {replyTarget.username === username ? "You" : replyTarget.username}
            </div>
            <div className="text-sm text-gray-700 break-words flex items-center gap-2 min-w-0">
              {(() => {
                const replyText = replyTarget.text || "";
                const replyTrimmed = replyText.trim();
                const replyIsGifUrl =
                  isGifUrl(replyTrimmed) && !replyTrimmed.includes(" ");
                const replyIsEmoji = isEmojiOnly(replyText);
                const replyStructuredGif =
                  (replyTarget as any).kind === "gif" &&
                  (replyTarget as any).media;
                const replyStructuredMedia =
                  (replyTarget as any).kind === "media" &&
                  (replyTarget as any).media;

                if (replyStructuredMedia) {
                  const media = (replyTarget as any).media;
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
                if (replyStructuredGif) {
                  return (
                    <span className="inline-block max-w-[60px] max-h-[60px]">
                      <AnimatedMedia
                        url={
                          (replyTarget as any).media.original ||
                          (replyTarget as any).media.gif ||
                          replyText
                        }
                        mediaSources={{
                          mp4: (replyTarget as any).media.mp4,
                          webm: (replyTarget as any).media.webm,
                          gif: (replyTarget as any).media.gif || replyText,
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
              })()}
            </div>
            <button
              type="button"
              onClick={cancelReplying}
              className="absolute top-1.5 right-1.5 text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring focus-visible:ring-blue-500 rounded"
              aria-label="Cancel reply"
              title="Cancel reply"
            >
              {/* X icon */}
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
        )}

        <div className="relative">
          {/* Center the row so the send button aligns with the textarea vertically */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              {/* Composer input inside a rounded container with tighter inner spacing */}
              <div className="relative w-full border rounded-full pl-8 pr-28 py-2 bg-white flex items-center">
                <AutoGrowTextarea
                  ref={inputRef}
                  className="w-full border-0 bg-transparent p-0 outline-none focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed resize-none text-sm leading-5"
                  value={messageInput}
                  maxRows={3}
                  placeholder={
                    editingMessage
                      ? "Edit your message..."
                      : replyTarget
                      ? `Reply to ${
                          replyTarget.username === username
                            ? "yourself"
                            : replyTarget.username
                        }…`
                      : "Type a message..."
                  }
                  disabled={!isConnected || !currentGroup}
                  onChange={(e) => {
                    const val = e.target.value;
                    const caret = e.target.selectionStart ?? val.length;
                    setMessageInput(val, caret);
                    const info = detectMention(val, caret);
                    if (info) {
                      const q = info.token.slice(1);
                      setMentionQuery(q);
                      setMentionOpen(true);
                      setMentionIndex(0);
                    } else if (mentionOpen) {
                      setMentionOpen(false);
                      setMentionQuery("");
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
                    if (mentionOpen) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setMentionIndex((i) =>
                          mentionCandidates.length
                            ? (i + 1) % mentionCandidates.length
                            : 0
                        );
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setMentionIndex((i) =>
                          mentionCandidates.length
                            ? (i - 1 + mentionCandidates.length) %
                              mentionCandidates.length
                            : 0
                        );
                        return;
                      }
                      if (e.key === "Enter" || e.key === "Tab") {
                        if (mentionCandidates.length) {
                          e.preventDefault();
                          insertMention(mentionCandidates[mentionIndex]);
                          return;
                        }
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setMentionOpen(false);
                        setMentionQuery("");
                        return;
                      }
                    }
                    // Enter sends; Shift+Enter inserts newline
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                    if (e.key === "Escape") {
                      if (editingMessage) cancelEditing();
                      else if (replyTarget) cancelReplying();
                      else if (sheetOpen) closeSheet();
                    }
                  }}
                />

                {/* Inline controls centered vertically within the container */}
                <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-0">
                  <button
                    type="button"
                    aria-label="Open emoji picker"
                    className="pointer-events-auto p-1 text-gray-500 transition focus:outline-none"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      if (inputRef.current) {
                        setCursorPos(
                          inputRef.current.selectionStart ?? messageInput.length
                        );
                      }
                      navigate("/emoji-picker");
                    }}
                  >
                    <Smiley size={22} />
                  </button>

                  {/* NEW: Media upload button (image/video) */}
                  <MediaUpload
                    title="Upload image or video"
                    className=""
                    disabled={!isConnected || !currentGroup}
                  />

                  <button
                    type="button"
                    aria-label="Open GIF picker"
                    className="pointer-events-auto text-gray-500 px-1.5 py-1 transition focus:outline-none"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      if (inputRef.current) {
                        setCursorPos(
                          inputRef.current.selectionStart ?? messageInput.length
                        );
                      }
                      navigate("/gif-picker");
                    }}
                  >
                    <Gif size={22} />
                  </button>
                </div>
              </div>
            </div>

            {/* Send button: no background, red icon fill when enabled, aligned center */}
            <button
              type="button"
              onClick={handleSendMessage}
              disabled={
                !isConnected ||
                !currentGroup ||
                (!messageInput.trim() && !editingMessage)
              }
              aria-label={
                editingMessage ? "Save edited message" : "Send message"
              }
              className={` focus:outline-none 
                ${
                  !isConnected ||
                  !currentGroup ||
                  (!messageInput.trim() && !editingMessage)
                    ? "text-gray-300 cursor-not-allowed"
                    : "text-red-500"
                }`}
            >
              {editingMessage ? (
                <Check size={24} weight="bold" />
              ) : (
                <PaperPlaneTilt size={24} weight="fill" />
              )}
            </button>
          </div>

          {/* Mention dropdown stays as-is */}
          {mentionOpen && mentionCandidates.length > 0 && (
            <div
              className="absolute bottom-full mb-1 left-0 w-64 max-h-60 overflow-auto rounded-md border bg-white shadow-lg text-sm z-50"
              role="listbox"
              aria-label="Mention suggestions"
            >
              {mentionCandidates.map((u, i) => {
                const active = i === mentionIndex;
                return (
                  <button
                    key={u}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                      insertMention(u);
                    }}
                    className={`block w-full text-left px-3 py-1.5 border-b last:border-b-0
                      ${
                        active
                          ? "bg-white font-semibold text-gray-900"
                          : "bg-white text-gray-700"
                      }
                      hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300`}
                  >
                    @{u}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* BottomSheet */}
      <BottomSheet
        isOpen={sheetOpen}
        onClose={closeSheet}
        title={
          uiState.kind === "sheet-confirm-delete"
            ? undefined
            : "Message actions"
        }
        ariaDescription="Actions you can take on the selected message"
      >
        {sheetMessage && uiState.kind === "sheet-actions" && (
          <div className="space-y-2" key="actions">
            {/* Reaction quick-pick row */}
            <div className="mb-2">
              <ReactionChooser message={sheetMessage} onPicked={closeSheet} />
            </div>

            <button
              onClick={handleReply}
              className="w-full text-left py-2 text-sm flex items-center gap-2"
              data-autofocus
            >
              <ArrowBendUpLeft size={18} />
              <span>Reply</span>
            </button>

            {/* NEW: Mention */}
            <button
              onClick={handleMention}
              className="w-full text-left py-2 text-sm flex items-center gap-2"
              title="Mention this user"
            >
              <At size={18} />
              <span>Mention</span>
            </button>

            {sheetMessage.username === username && (
              <>
                <button
                  onClick={handleEdit}
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
                  <PencilSimple size={18} />
                  <span>Edit</span>
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleteDisabled}
                  className={`w-full text-left py-2 text-sm flex items-center gap-2${
                    deleteDisabled
                      ? " text-red-400 cursor-not-allowed"
                      : " text-red-600"
                  }`}
                >
                  <Trash size={18} />
                  <span>Delete</span>
                </button>
              </>
            )}

            <button
              onClick={() => {
                console.log("Report spam", sheetMessage);
                closeSheet();
              }}
              className="w-full text-left py-2 text-sm flex items-center gap-2"
            >
              <Flag size={18} />
              <span>Report as spam</span>
            </button>
          </div>
        )}

        {sheetMessage && uiState.kind === "sheet-confirm-delete" && (
          <div className="space-y-4 text-center" role="alert" key="confirm">
            <div className="text-sm font-semibold text-red-600 flex items-center gap-2 justify-center">
              <Trash size={18} weight="bold" aria-hidden="true" />
              Confirm deletion
            </div>
            <div className="text-xs text-gray-500 leading-snug">
              This will permanently mark the message as deleted for everyone.
            </div>
            <div className="p-3 rounded-md bg-gray-100 text-sm text-gray-700 mx-auto">
              <div className="flex items-center gap-2 min-w-0">
                {(() => {
                  const m = sheetMessage as any;
                  const text = (m.text || "").trim();
                  const structuredMedia = m.kind === "media" && m.media;
                  const structuredGif = m.kind === "gif" && m.media;
                  const singleGifUrl =
                    !!text && isGifUrl(text) && !text.includes(" ");

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
                  // Show text-only preview only when there's no media/gif
                  const m = sheetMessage as any;
                  const text = (m.text || "").trim();
                  const hasMedia =
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
            <div className="flex gap-3 pt-2 justify-center">
              <button
                onClick={cancelDeleteConfirmation}
                className="px-4 py-2 rounded-md border text-sm font-medium"
                data-autofocus
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleteDisabled}
                className={`px-4 py-2 rounded-md text-sm font-semibold shadow focus:outline-none focus-visible:ring ${
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

      {/* Reactions Drawer */}
      <ReactionDrawer
        open={reactionsOpen}
        onClose={() => setReactionsOpen(false)}
        message={reactionsMessage}
        title="People who reacted"
      />
    </div>
  );
};

export default ChatPage;

// Detect if the message text is purely one or more emoji (no other visible chars)
function isEmojiOnly(text?: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  // Remove spaces, variation selectors, zero-width joiners
  const cleaned = trimmed.replace(/[\s\uFE0F\u200D]/g, "");
  if (!cleaned) return false;
  try {
    // All remaining code points must be Extended_Pictographic
    return /^(?:\p{Extended_Pictographic})+$/u.test(cleaned);
  } catch {
    // If the runtime doesn't support Unicode property escapes, fail gracefully
    return false;
  }
}
