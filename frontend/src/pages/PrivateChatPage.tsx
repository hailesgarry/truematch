import React, {
  useState,
  useEffect,
  useRef,
  useReducer,
  useCallback,
} from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowLeft } from "@phosphor-icons/react";
import { useAuthStore } from "../stores/authStore";
// no group store needed for DM page
import { useSocketStore } from "../stores/socketStore";
import { useMessageStore } from "../stores/messageStore";
import { useComposerStore } from "../stores/composerStore";
// DM page does not use REST services here
import type { Message, ReactionEmoji } from "../types";
// BottomSheet usage refactored into MessageActionSheet
import MessageActionSheet from "../components/chat/MessageActionSheet";
import MessageActionModal from "../components/chat/MessageActionModal";
import "./ChatPage.css";
// Bubble colors are now unified to a single gray across the app
import { useNotificationStore } from "../stores/notificationStore";
// ReactionChooser moved inside MessageActionSheet
import { directRoomIdFor } from "../utils/direct";
import { useAvatarStore } from "../stores/avatarStore";
import { usePresenceStore } from "../stores/presenceStore";
import { useTypingStore } from "../stores/typingStore";
import FullscreenOverlay from "../components/ui/FullscreenOverlay";
import EmojiPickerPage from "./EmojiPickerPage";
import GifPickerPage from "./GifPickerPage";
import RelativeTime from "../components/common/RelativeTime";
import TypingIndicator from "../components/chat/TypingIndicator";
import { useDmMessagesQuery, dmMessagesKey } from "../hooks/useDmMessagesQuery";
import { extractLinks } from "../utils/links";
import { routeStartsWith } from "../utils/routes.ts";
import { useLinkPreview } from "../hooks/useLinkPreview";
import {
  collectVideoUrls,
  prefetchMediaBlob,
} from "../hooks/useCachedMediaBlob";
import { useComposerDraftCache } from "../hooks/useComposerDraftCache";
import { cacheUserIdentity, resolveUserIdentity } from "../lib/userIdentity";
import { useUiStore } from "../stores/uiStore";
import DmMessageList from "./direct/components/DmMessageList";
import ComposerPanel from "./direct/components/ComposerPanel";
import { QUICK_REACTION_EMOJIS } from "./chat/chatConstants";
import ScrollRestoration, {
  type ScrollRestorationHandle,
} from "../components/common/ScrollRestoration";

// NEW: Large media size threshold (bytes) – used to optionally gate autoplay/loading
const LARGE_MEDIA_THRESHOLD = 6 * 1024 * 1024; // 6 MB

const PEER_BUBBLE_BG = "#E9ECEF"; // Tailwind chat-bubble custom color
const PEER_BUBBLE_FG = "#0f172a"; // Tailwind slate-900
const SELF_BUBBLE_BG =
  "linear-gradient(to right, #e91e8c 0%, #d41f8e 30%, #ca209e 50%, #c820c8 70%, #b521d4 100%)";
const SELF_BUBBLE_FG = "#ffffff";

const truncate = (s: string, max = 80) =>
  s.length > max ? s.slice(0, max - 1) + "…" : s;

function tokenizeMentions(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /@([A-Za-z0-9_]{1,32})/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const full = match[0];
    parts.push(
      <span
        key={`mention-${match.index}`}
        className="font-semibold text-grey-900"
      >
        {full}
      </span>
    );
    last = match.index + full.length;
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
  // const [imageReady, setImageReady] = React.useState(false);
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

  const dimsClass =
    "rounded-md shadow-sm object-contain w-auto max-w-full h-auto mx-auto";

  const containerClasses = large
    ? "flex flex-col w-full max-w-full bg-black rounded-md overflow-hidden"
    : "inline-block my-1 w-full max-w-full bg-black rounded-md overflow-hidden";

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
        // onLoad={() => setImageReady(true)}
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
        // onLoad={() => setImageReady(true)}
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
  const links = extractLinks(text);

  const renderSegment = (
    segment: string,
    keyPrefix: string
  ): React.ReactNode[] => {
    if (!segment) return [];
    const pieces = segment.split(/(\s+)/);
    return pieces.map((piece, idx) => {
      if (isGifUrl(piece)) {
        return <AnimatedMedia key={`${keyPrefix}-gif-${idx}`} url={piece} />;
      }
      if (/[@]/.test(piece)) {
        return (
          <React.Fragment key={`${keyPrefix}-mention-${idx}`}>
            {tokenizeMentions(piece)}
          </React.Fragment>
        );
      }
      return (
        <React.Fragment key={`${keyPrefix}-text-${idx}`}>
          {piece}
        </React.Fragment>
      );
    });
  };

  if (links.length === 0) {
    return renderSegment(text, "segment");
  }

  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  links.forEach((link, idx) => {
    if (link.index > cursor) {
      const before = text.slice(cursor, link.index);
      nodes.push(...renderSegment(before, `before-${idx}`));
    }

    const isGif = isGifUrl(link.url);
    if (isGif) {
      nodes.push(<AnimatedMedia key={`link-gif-${idx}`} url={link.url} />);
      if (link.suffix) {
        nodes.push(
          <React.Fragment key={`link-gif-suffix-${idx}`}>
            {link.suffix}
          </React.Fragment>
        );
      }
    } else {
      nodes.push(
        <React.Fragment key={`link-${idx}`}>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="break-words text-blue-700 underline decoration-blue-500 decoration-1 underline-offset-2 transition hover:text-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            {link.display}
          </a>
          {link.suffix ? link.suffix : null}
        </React.Fragment>
      );
    }

    cursor = link.index + link.length;
  });

  if (cursor < text.length) {
    const tail = text.slice(cursor);
    nodes.push(...renderSegment(tail, "tail"));
  }

  return nodes;
}

// NEW: helper to detect if a message is GIF-only (structured gif or single GIF URL)
function isGifOnlyMessage(m: Message): boolean {
  const structuredGif = (m as any).kind === "gif" && (m as any).media;
  const trimmed = (m.text || "").trim();
  const singleGifUrl = !!trimmed && isGifUrl(trimmed) && !trimmed.includes(" ");
  return !!structuredGif || !!singleGifUrl;
}

function isVoiceNoteMessage(m: Message): boolean {
  const kind = (m as any).kind;
  if (kind === "audio") return true;
  const audio = (m as any).audio;
  return !!audio && typeof audio === "object";
}

function isImageUrl(url: string): boolean {
  return /\.(png|jpe?g|webp|avif|heic|heif|bmp)(\?|#|$)/i.test(url);
}

function isMediaAttachmentMessage(m: Message): boolean {
  const media = (m as any).media;
  if (media && typeof media === "object") {
    const kind = (m as any).kind;
    if (kind === "audio") return false;
    return true;
  }
  const trimmed = (m.text || "").trim();
  if (!trimmed || trimmed.includes(" ")) return false;
  if (isGifUrl(trimmed)) return true;
  if (isVideoUrl(trimmed)) return true;
  if (isImageUrl(trimmed)) return true;
  return false;
}

// Add helpers near other helpers
function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url);
}

// --- end GIF helpers (extended) ---

// Using RelativeTime component for timestamps

const PrivateChatPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { userId: peerParamRaw = "" } = useParams<{ userId?: string }>();
  const peerParam = (peerParamRaw || "").trim();
  const { username, joined } = useAuthStore();
  const locationState = (location.state ?? {}) as {
    userId?: string;
    username?: string;
    [key: string]: unknown;
  };
  const stateUserId =
    typeof locationState.userId === "string" ? locationState.userId : "";
  const stateUsername =
    typeof locationState.username === "string" ? locationState.username : "";
  type PeerIdentity = { userId: string; username: string };
  const [peerIdentity, setPeerIdentity] = useState<PeerIdentity | null>(() => {
    if (stateUserId && stateUsername) {
      cacheUserIdentity(stateUserId, stateUsername);
      return { userId: stateUserId, username: stateUsername };
    }
    if (stateUserId) return { userId: stateUserId, username: "" };
    if (stateUsername) return { userId: "", username: stateUsername };
    return null;
  });
  const [identityLoading, setIdentityLoading] = useState(false);
  const [identityError, setIdentityError] = useState(false);
  // NEW: get my userId to detect my current reaction in the sheet
  // const myUserId = useAuthStore((s) => s.userId) || "";
  const getAvatar = useAvatarStore((s) => s.getAvatar);
  const ensureAvatar = useAvatarStore((s) => s.ensure);
  const peerName = peerIdentity?.username || "";
  const peerDisplayName = peerName || peerParam;
  const peerAvatar = useAvatarStore((s) =>
    peerName ? s.avatars[peerName.toLowerCase()] || null : null
  );
  const shouldShowIdentitySpinner = identityLoading && !peerName;
  const identityFailed = identityError && !peerName && !identityLoading;

  useEffect(() => {
    if (!stateUserId && !stateUsername) return;
    setPeerIdentity((prev) => {
      const nextUserId = stateUserId || prev?.userId || "";
      const nextUsername = stateUsername || prev?.username || "";
      if (
        prev &&
        prev.userId === nextUserId &&
        prev.username === nextUsername
      ) {
        return prev;
      }
      if (stateUserId && stateUsername) {
        cacheUserIdentity(stateUserId, stateUsername);
      }
      return { userId: nextUserId, username: nextUsername };
    });
  }, [stateUserId, stateUsername]);

  useEffect(() => {
    const token = peerParam;
    if (!token) {
      setIdentityLoading(false);
      setIdentityError(false);
      return;
    }
    if (
      peerIdentity &&
      peerIdentity.userId === token &&
      peerIdentity.username
    ) {
      setIdentityLoading(false);
      setIdentityError(false);
      return;
    }
    let cancelled = false;
    setIdentityLoading(true);
    setIdentityError(false);
    resolveUserIdentity({ userId: token })
      .then((identity) => {
        if (cancelled) return;
        if (identity) {
          cacheUserIdentity(identity.userId, identity.username);
          setPeerIdentity(identity);
          setIdentityError(false);
        } else if (!peerIdentity) {
          setIdentityError(true);
        }
      })
      .catch(() => {
        if (!cancelled && !peerIdentity) {
          setIdentityError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setIdentityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [peerParam, peerIdentity]);
  // defined earlier
  const {
    isConnected,
    ensureConnected,
    // DM APIs
    joinDM,
    leaveDM,
    setActiveDM,
    activeDmId,
  } = useSocketStore();
  const sendDirectMessage = useSocketStore((s) => s.sendDirectMessage);
  const editDirectMessage = useSocketStore((s) => s.editDirectMessage);
  const deleteDirectMessage = useSocketStore((s) => s.deleteDirectMessage);
  const reactToDirectMessage = useSocketStore((s) => s.reactToDirectMessage);
  const { messages } = useMessageStore();
  const showToast = useUiStore((s) => s.showToast);
  const {
    activeScope,
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

  // DM page doesn't fetch group info
  // Removed header dropdown menu for DM page

  // REMOVE: editingMessage state (handled by union)
  // const [editingMessage, setEditingMessage] = useState<Message | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Add back the end-of-list anchor ref
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Track the last "my message" we've seen to avoid scrolling on mount/group switch
  const myLastKeyRef = useRef<string | number | null>(null);
  const isExplicitLeave = useRef(false);
  const triedFallback = useRef(false);
  // Removed menuRef/menu state
  const scrollRef = useRef<HTMLDivElement>(null); // NEW: Scroll container ref
  const scrollRestorationRef = useRef<ScrollRestorationHandle | null>(null);
  const hasRestoredScrollRef = useRef(false);
  const hadStoredScrollRef = useRef(false);
  const qc = useQueryClient();

  useEffect(() => {
    return () => {
      scrollRestorationRef.current?.save();
    };
  }, []);

  // NEW: refs map for each message row + highlighted key
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const resolveAvatar = useCallback(
    (author?: string | null) => {
      if (!author) return null;
      const avatar = getAvatar(author);
      return avatar ? String(avatar) : null;
    },
    [getAvatar]
  );
  const [composerPreviewDismissedFor, setComposerPreviewDismissedFor] =
    useState<string | null>(null);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);

  // Bubble colors are simple: gradient for self, gray for peers

  // Ensure we have the peer's latest avatar from the server
  useEffect(() => {
    if (peerName) ensureAvatar(peerName);
  }, [peerName, ensureAvatar]);

  // Gradient for self bubbles, neutral gray for peers
  function getColorForMessage(m: Message): { bg: string; fg: string } {
    if (m.username === username) {
      return { bg: SELF_BUBBLE_BG, fg: SELF_BUBBLE_FG };
    }
    return { bg: PEER_BUBBLE_BG, fg: PEER_BUBBLE_FG };
  }

  // Guard + establish DM room
  useEffect(() => {
    if (!joined) {
      navigate("/", { replace: true });
      return;
    }
    ensureConnected();

    if (!peerName) return;
    const dmId = directRoomIdFor(username || "", peerName);
    joinDM(dmId, peerName);
    setActiveDM(dmId);

    return () => {
      // leave DM when explicitly navigating back from this page
      if (isExplicitLeave.current) {
        leaveDM(dmId);
        isExplicitLeave.current = false;
      }
    };
  }, [
    joined,
    peerName,
    username,
    ensureConnected,
    joinDM,
    setActiveDM,
    leaveDM,
    navigate,
  ]);

  // no group join here; handled by DM join above

  // Fallback REST fetch
  useEffect(() => {
    // For DMs, history is provided over socket on join; no REST fallback
    const dmId = activeDmId;
    if (!dmId) return;
    const existing = messages[dmId] || [];
    if (!isConnected) return;
    if (existing.length > 0) return;
    if (triedFallback.current) return;
    // No REST; just mark that we tried to avoid looping
    triedFallback.current = true;
  }, [isConnected, activeDmId, messages]);

  // REMOVE this effect to disable all auto-scroll
  // useEffect(() => {
  //   messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  // }, [messages, currentGroup?.id]);

  const dmId =
    activeDmId || (peerName ? directRoomIdFor(username || "", peerName) : null);
  const scrollStorageKey = React.useMemo(
    () => (dmId ? `__dm:scroll:${dmId}` : "__dm:scroll:unknown"),
    [dmId]
  );
  // React Query: access cached/thread messages with keepPreviousData semantics
  const { data: cachedMessages } = useDmMessagesQuery(dmId, true);
  const currentMessages = dmId
    ? cachedMessages && cachedMessages.length
      ? cachedMessages
      : messages[dmId] || []
    : [];

  const handleVoiceNoteDuration = React.useCallback(
    (msg: Message, durationMs: number) => {
      if (!dmId) return;
      const sanitized = Math.max(0, Math.round(durationMs));
      if (!sanitized) return;
      try {
        useMessageStore.getState().setAudioDuration(dmId, msg, sanitized);
      } catch {}

      try {
        const composer = useComposerStore.getState();
        const target = composer.replyTarget as any;
        if (!target) return;
        const matches = msg.messageId
          ? target.messageId === msg.messageId
          : target.username === msg.username &&
            ((target.timestamp ?? null) === (msg.timestamp ?? null) ||
              String(target.timestamp ?? "") === String(msg.timestamp ?? ""));
        if (matches) composer.setReplyTarget(msg as any);
      } catch {}
    },
    [dmId]
  );

  // Keep query cache in sync when store changes (lightweight): on dmId change, seed cache
  useEffect(() => {
    if (!dmId) return;
    const list = useMessageStore.getState().messages[dmId] || [];
    qc.setQueryData(dmMessagesKey(dmId), list);
  }, [dmId, qc, messages]);

  // Ensure composer state is scoped per DM to avoid bleed into rooms or other DMs
  useEffect(() => {
    if (dmId) setScope(`dm:${dmId}`);
    else setScope("dm:");
  }, [dmId, location.pathname]);

  useComposerDraftCache(activeScope, messageInput, cursorPos, setMessageInput);

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
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [actionAnchorRect, setActionAnchorRect] = useState<DOMRect | null>(
    null
  );

  // Derived helpers
  const sheetOpen =
    uiState.kind === "sheet-actions" || uiState.kind === "sheet-confirm-delete";
  const sheetMessage =
    uiState.kind === "sheet-actions" || uiState.kind === "sheet-confirm-delete"
      ? uiState.message
      : null;
  const actionUiKind =
    uiState.kind === "sheet-actions"
      ? "actions"
      : uiState.kind === "sheet-confirm-delete"
      ? "confirm-delete"
      : "idle";
  const editingMessage = uiState.kind === "editing" ? uiState.message : null;

  // Get pending sets from socket store
  const { pendingEdits, pendingDeletes } = useSocketStore();

  const keyFor = (m: any) =>
    m?.messageId ? `id:${m.messageId}` : `ts:${m?.username}|${m?.timestamp}`;

  // no sheetMsgKey usage on DM page

  // NEW: block editing for GIF-only or emoji-only messages
  const editKindBlocked =
    !!sheetMessage &&
    (isGifOnlyMessage(sheetMessage) ||
      isEmojiOnly(sheetMessage.text) ||
      isVoiceNoteMessage(sheetMessage) ||
      isMediaAttachmentMessage(sheetMessage));

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

  const copyDisabled =
    !sheetMessage ||
    !(sheetMessage.text || "").trim() ||
    isVoiceNoteMessage(sheetMessage) ||
    isMediaAttachmentMessage(sheetMessage);

  const deleteDisabled =
    !!sheetMessage &&
    (pendingDeletes.has(`id:${sheetMessage.messageId}`) ||
      pendingDeletes.has(
        `ts:${sheetMessage.username}|${sheetMessage.timestamp}`
      ));

  const composerLinks = React.useMemo(
    () => extractLinks(messageInput || ""),
    [messageInput]
  );

  const composerPreviewCandidate = React.useMemo(() => {
    for (const link of composerLinks) {
      if (
        !isGifUrl(link.url) &&
        !isVideoUrl(link.url) &&
        !isImageUrl(link.url)
      ) {
        return link.url;
      }
    }
    return null;
  }, [composerLinks]);

  useEffect(() => {
    if (!composerPreviewCandidate) {
      if (composerPreviewDismissedFor !== null) {
        setComposerPreviewDismissedFor(null);
      }
      return;
    }
    if (
      composerPreviewDismissedFor &&
      composerPreviewCandidate !== composerPreviewDismissedFor
    ) {
      setComposerPreviewDismissedFor(null);
    }
  }, [composerPreviewCandidate, composerPreviewDismissedFor]);

  const composerPreviewActiveUrl =
    composerPreviewCandidate &&
    composerPreviewCandidate !== composerPreviewDismissedFor
      ? composerPreviewCandidate
      : null;

  const composerPreviewQuery = useLinkPreview(composerPreviewActiveUrl, {
    enabled: Boolean(composerPreviewActiveUrl),
  });

  // -------------------------
  // Existing effects unchanged (except remove setReplyTo uses)
  // -------------------------

  // Auto-close sheet or cancel edit/reply if the underlying message got deleted or disappeared
  useEffect(() => {
    const did = dmId;
    if (!did) return;
    const list = messages[did] || [];
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
  }, [messages, dmId, sheetMessage, editingMessage]);

  // Navigation / room management handlers (restored)
  const handleBack = () => {
    scrollRestorationRef.current?.save();
    isExplicitLeave.current = true;
    const from = (location.state as any)?.from as string | undefined;
    if (typeof from === "string" && from.startsWith("/chat")) {
      navigate(from);
      return;
    }
    if (from === "/direct") {
      navigate("/direct");
      return;
    }
    // Fallback: if we have history, go back; else default to Direct list
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
    navigate("/direct");
  };

  if (shouldShowIdentitySpinner) {
    return (
      <div className="flex h-full items-center justify-center bg-white">
        <span className="text-sm text-gray-500">Loading conversation…</span>
      </div>
    );
  }

  if (identityFailed) {
    return (
      <div className="flex h-full flex-col bg-white">
        <div className="p-4">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center gap-2 text-sm font-medium text-gray-700"
          >
            <ArrowLeft size={18} weight="bold" aria-hidden="true" />
            <span>Back</span>
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center px-6 text-center text-sm text-gray-500">
          Unable to find that user.
        </div>
      </div>
    );
  }

  // Removed leave room button/menu for DM header

  // -------------------------
  // Handlers (updated)
  // -------------------------
  const openActionsFor = useCallback(
    (m: Message) => {
      dispatchUI({ type: "OPEN_ACTIONS", message: m });
    },
    [dispatchUI]
  );

  const closeSheet = useCallback(() => {
    dispatchUI({ type: "CLOSE_SHEET" });
  }, [dispatchUI]);

  const closeAllActionSurfaces = useCallback(() => {
    setActionModalOpen(false);
    setActionAnchorRect(null);
    closeSheet();
  }, [closeSheet]);

  const openActionModal = useCallback(
    (m: Message, anchor?: HTMLElement | null) => {
      dispatchUI({ type: "OPEN_ACTIONS", message: m });
      let resolvedAnchor = anchor ?? null;
      if (!resolvedAnchor) {
        const guessedKey = keyFor(m);
        resolvedAnchor = messageRefs.current.get(guessedKey) ?? null;
      }
      setActionAnchorRect(
        resolvedAnchor ? resolvedAnchor.getBoundingClientRect() : null
      );
      setActionModalOpen(true);
    },
    [dispatchUI, keyFor]
  );

  const handleQuickReactionSelect = useCallback(
    (emoji: ReactionEmoji) => {
      if (!sheetMessage) {
        return;
      }
      const target =
        dmId && !(sheetMessage as any).dmId
          ? ({ ...(sheetMessage as any), dmId } as Message)
          : sheetMessage;
      try {
        reactToDirectMessage(target, emoji);
      } finally {
        closeAllActionSurfaces();
      }
    },
    [sheetMessage, dmId, reactToDirectMessage, closeAllActionSurfaces]
  );

  const handleQuickReact = useCallback(
    (message: Message) => {
      const target =
        dmId && !(message as any).dmId
          ? ({ ...(message as any), dmId } as Message)
          : message;
      const emoji = QUICK_REACTION_EMOJIS[0] ?? "❤️";
      try {
        reactToDirectMessage(target, emoji);
      } catch {
        // ignore quick reaction errors; the action sheet remains a fallback
      }
    },
    [dmId, reactToDirectMessage]
  );

  const handleDelete = () => {
    if (!sheetMessage || sheetMessage.username !== username) {
      closeAllActionSurfaces();
      return;
    }
    dispatchUI({ type: "OPEN_CONFIRM_DELETE" });
  };

  const focusComposerForReply = useCallback(
    (message: Message | null) => {
      if (!message) return;
      setReplyTarget(message);
      window.setTimeout(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        try {
          const len = el.value.length;
          el.setSelectionRange?.(len, len);
        } catch {
          // ignore selection errors on older browsers
        }
      }, 40);
    },
    [setReplyTarget]
  );

  const handleReply = () => {
    if (sheetMessage) {
      focusComposerForReply(sheetMessage);
    }
    closeAllActionSurfaces();
  };

  // Mentions removed for DM page

  const handleCopy = async () => {
    if (!sheetMessage) {
      closeAllActionSurfaces();
      return;
    }

    const text = (sheetMessage.text || "").trim();
    if (
      !text ||
      isVoiceNoteMessage(sheetMessage) ||
      isMediaAttachmentMessage(sheetMessage)
    ) {
      showToast("Nothing to copy", 1600);
      return;
    }

    const fallbackCopy = () => {
      if (typeof document === "undefined") {
        throw new Error("Clipboard unavailable");
      }
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "absolute";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      const selection = window.getSelection();
      const originalRange =
        selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      textarea.select();
      const succeeded = document.execCommand("copy");
      if (selection) {
        selection.removeAllRanges();
        if (originalRange) {
          selection.addRange(originalRange);
        }
      }
      document.body.removeChild(textarea);
      if (!succeeded) {
        throw new Error("execCommand failed");
      }
    };

    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(text);
      } else {
        fallbackCopy();
      }
      showToast("Message copied", 1800, "success");
      closeAllActionSurfaces();
    } catch (err) {
      showToast("Unable to copy message", 2200, "error");
    }
  };

  const handleEdit = () => {
    if (sheetMessage) {
      // Guard: disallow editing GIF-only or emoji-only messages
      if (isGifOnlyMessage(sheetMessage) || isEmojiOnly(sheetMessage.text)) {
        closeAllActionSurfaces();
        return;
      }
      dispatchUI({ type: "START_EDIT", message: sheetMessage });
      setMessageInput(sheetMessage.text, sheetMessage.text.length);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
    closeAllActionSurfaces();
  };

  const confirmDelete = () => {
    if (sheetMessage) {
      deleteDirectMessage(sheetMessage);
    }
    closeAllActionSurfaces();
  };

  const cancelDeleteConfirmation = () => {
    if (sheetMessage) {
      dispatchUI({ type: "OPEN_ACTIONS", message: sheetMessage });
      if (actionModalOpen) {
        setActionModalOpen(true);
      }
    } else {
      dispatchUI({ type: "CLOSE_SHEET" });
      setActionModalOpen(false);
      setActionAnchorRect(null);
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

  const handleSwipeReply = useCallback(
    (message: Message) => {
      focusComposerForReply(message);
    },
    [focusComposerForReply]
  );

  const handleSendMessage = () => {
    if (!messageInput.trim()) return;

    if (editingMessage) {
      editDirectMessage(editingMessage, messageInput);
      dispatchUI({ type: "CANCEL_EDIT" });
      resetDraft();
      return;
    } else {
      sendDirectMessage(messageInput, replyTarget || null, {
        kind: "text",
        dmId: dmId || undefined,
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

  // Mentions removed for DM page

  // (Add this effect inside the component, e.g., after other useEffects)
  // Removed dropdown menu effect

  // peerName and peerAvatar are defined earlier

  // Reset unread for current DM when viewing chat
  useEffect(() => {
    if (!dmId) return;
    const isDMRoute = routeStartsWith(location.pathname, "/dm/");
    if (!isDMRoute) return;
    const resetForDM = () => {
      try {
        useNotificationStore.getState().reset(dmId);
      } catch {}
    };
    resetForDM();
    const onVis = () => {
      if (document.visibilityState === "visible") resetForDM();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [dmId]);

  // Peer presence / last active
  const isPeerOnline = usePresenceStore((s) => s.isOnline(peerName));
  const peerLastActive = usePresenceStore(
    (s) => s.getLastActive(peerName) ?? null
  );
  const isPeerTyping = useTypingStore((s) =>
    dmId && peerName ? s.isTyping(dmId, peerName) : false
  );
  const clearTypingForDm = useTypingStore((s) => s.clearDm);

  useEffect(() => {
    if (!dmId) return;
    return () => {
      clearTypingForDm(dmId);
    };
  }, [dmId, clearTypingForDm]);

  // Presence: show online green dot on avatar when user is online
  // isPeerOnline defined above

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
  // Virtualizer setup for very long conversations
  const renderMessages = currentMessages;

  useEffect(() => {
    hasRestoredScrollRef.current = false;
    if (typeof window === "undefined") {
      hadStoredScrollRef.current = false;
      return;
    }
    try {
      hadStoredScrollRef.current =
        sessionStorage.getItem(scrollStorageKey) != null;
    } catch {
      hadStoredScrollRef.current = false;
    }
  }, [scrollStorageKey]);

  useEffect(() => {
    if (!renderMessages.length) return;
    const urls = new Set<string>();
    for (const msg of renderMessages) {
      const candidates = collectVideoUrls(msg);
      for (const url of candidates) {
        if (!url || !/^https?:\/\//i.test(url)) continue;
        urls.add(url);
      }
    }
    if (!urls.size) return;
    const targets = Array.from(urls).slice(-8);
    targets.forEach((url) => {
      prefetchMediaBlob(qc, url).catch(() => {});
    });
  }, [renderMessages, qc]);
  const useVirtual = renderMessages.length > 400;
  const virtualizer = useVirtual
    ? useVirtualizer({
        count: renderMessages.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => 84,
        overscan: 12,
      })
    : null;

  useEffect(() => {
    if (hasRestoredScrollRef.current) return;
    if (!renderMessages.length) return;

    if (hadStoredScrollRef.current && scrollRestorationRef.current) {
      scrollRestorationRef.current.restore();
      hasRestoredScrollRef.current = true;
      return;
    }

    hasRestoredScrollRef.current = true;
    if (useVirtual && virtualizer) {
      const last = renderMessages.length - 1;
      if (last >= 0) virtualizer.scrollToIndex(last, { align: "end" });
    } else {
      requestAnimationFrame(() =>
        messagesEndRef.current?.scrollIntoView({ behavior: "auto" })
      );
    }
  }, [renderMessages.length, useVirtual, virtualizer, scrollStorageKey]);

  useEffect(() => {
    prevCountRef.current = 0;
    if (!hasRestoredScrollRef.current) return;
    if (useVirtual && virtualizer) {
      const last = renderMessages.length - 1;
      if (last >= 0) virtualizer.scrollToIndex(last, { align: "end" });
    } else {
      requestAnimationFrame(() =>
        messagesEndRef.current?.scrollIntoView({ behavior: "auto" })
      );
    }
  }, [dmId, useVirtual, virtualizer, renderMessages.length]);

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
    (reply: {
      messageId?: string;
      username: string;
      timestamp?: string | number | null;
    }) => {
      if (!dmId) return;
      const list = messages[dmId] || [];

      // Coercion helpers
      const toNum = (ts: unknown) => (typeof ts === "number" ? ts : Number(ts));
      const hasMessageId = !!(reply as any).messageId;
      const replyTs = (reply as any).timestamp;
      const replyTsNum = toNum(replyTs);
      const replyTsStr =
        typeof replyTs === "string" || typeof replyTs === "number"
          ? String(replyTs)
          : "";

      const target =
        list.find((mm: any) => {
          if (
            hasMessageId &&
            mm.messageId &&
            mm.messageId === (reply as any).messageId
          )
            return true;
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

      // If virtualized, prefer index-based scroll
      if (useVirtual && virtualizer) {
        const idx = renderMessages.findIndex((mm: any) => {
          if (mm.messageId && (target as any).messageId)
            return mm.messageId === (target as any).messageId;
          return (
            mm.username === reply.username &&
            String(mm.timestamp) === String(reply.timestamp ?? "")
          );
        });
        if (idx >= 0) {
          const vis = virtualizer.getVirtualItems();
          const isVisible = vis.some((vi) => vi.index === idx);
          setHighlightedKey(k);
          window.setTimeout(() => setHighlightedKey(null), 1600);
          if (!isVisible) virtualizer.scrollToIndex(idx, { align: "center" });
        }
        return;
      }

      const el = messageRefs.current.get(k);
      const container = scrollRef.current;
      const isInView = (node: HTMLDivElement) => {
        if (!container) return false;
        const cRect = container.getBoundingClientRect();
        const nRect = node.getBoundingClientRect();
        const margin = 6;
        return (
          nRect.top >= cRect.top + margin &&
          nRect.bottom <= cRect.bottom - margin
        );
      };
      const act = (node?: HTMLDivElement) => {
        if (!node) return;
        if (!isInView(node)) {
          node.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        setHighlightedKey(k);
        window.setTimeout(() => setHighlightedKey(null), 1600);
      };
      if (el) act(el);
      else requestAnimationFrame(() => act(messageRefs.current.get(k)));
    },
    [dmId, messages, useVirtual, virtualizer, renderMessages]
  );

  // Prefetch peer avatar from message history if header lacks it
  useEffect(() => {
    const get = useAvatarStore.getState().getAvatar;
    const have = get(peerName);
    if (have || !peerName) return;
    const lc = peerName.toLowerCase();
    for (let i = renderMessages.length - 1; i >= 0; i--) {
      const m = renderMessages[i] as any;
      if ((m?.username || "").toLowerCase() === lc && m?.avatar) {
        useAvatarStore.getState().setFromMessage(peerName, String(m.avatar));
        break;
      }
    }
  }, [peerName, renderMessages]);

  return (
    <div className="flex flex-col h-screen">
      {/* Clean white header for DM (56px mobile, 64px at sm+) */}
      <div className="sticky top-0 z-10 bg-white border-b">
        <div className="flex items-center gap-4 px-3 h-14 sm:h-16">
          <button
            onClick={handleBack}
            className="text-gray-900 "
            aria-label="Back to direct messages"
          >
            <ArrowLeft size={24} />
          </button>

          <div className="relative w-9 h-9">
            {peerAvatar ? (
              <img
                src={peerAvatar}
                alt={`${peerDisplayName || "Friend"} avatar`}
                className="w-9 h-9 rounded-full object-cover"
                width={36}
                height={36}
                decoding="async"
                fetchPriority="high"
                draggable={false}
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-gray-200 text-gray-700 flex items-center justify-center text-xs font-semibold select-none">
                {(peerDisplayName || "??").slice(0, 2).toUpperCase()}
              </div>
            )}
            {isPeerOnline && (
              <span
                className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-green-500 ring-2 ring-white"
                title="Online"
                aria-label="Online"
                role="status"
              />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="text-message font-semibold text-gray-900 truncate">
              {peerDisplayName}
            </div>
            <div className="text-xs text-gray-500 truncate">
              {isPeerOnline ? (
                <TypingIndicator
                  active={isPeerTyping}
                  label={isPeerTyping ? undefined : " "}
                  ariaLabel={
                    isPeerTyping
                      ? `${peerDisplayName || "Friend"} is typing`
                      : undefined
                  }
                />
              ) : (
                <RelativeTime
                  value={peerLastActive}
                  minUnit="minute"
                  withSuffix={true}
                  hideBelowMin={false}
                  showJustNowBelowMin={true}
                  justNowThresholdMs={60_000}
                  roundUpMinuteFloorToOne={true}
                  fallback="Offline"
                />
              )}
            </div>
          </div>
          {/* Dropdown/caret removed for this page */}
        </div>
      </div>

      <ScrollRestoration
        ref={scrollRestorationRef}
        targetRef={scrollRef as React.RefObject<HTMLElement | null>}
        storageKey={scrollStorageKey}
        manualRestore
      />

      {/* Messages */}
      <DmMessageList
        scrollRef={scrollRef}
        messagesEndRef={messagesEndRef}
        messageRefs={messageRefs}
        renderMessages={renderMessages}
        useVirtual={useVirtual}
        virtualizer={virtualizer}
        highlightedKey={highlightedKey}
        username={username}
        lookupAvatar={resolveAvatar}
        keyFor={keyFor}
        getColorForMessage={getColorForMessage}
        openActionsFor={openActionsFor}
        openModalFor={openActionModal}
        scrollToReferenced={scrollToReferenced}
        handleVoiceNoteDuration={handleVoiceNoteDuration}
        tokenizeTextWithGifs={tokenizeTextWithGifs}
        AnimatedMedia={AnimatedMedia}
        isGifUrl={isGifUrl}
        isVideoUrl={isVideoUrl}
        isImageUrl={isImageUrl}
        truncate={truncate}
        isEmojiOnly={isEmojiOnly}
        isConnected={isConnected}
        dmId={dmId}
        onQuickReact={handleQuickReact}
        onSwipeReply={handleSwipeReply}
      />

      {/* Input + Reply / Edit Preview */}
      <ComposerPanel
        scopeKey={activeScope}
        messageInput={messageInput}
        setMessageInput={setMessageInput}
        setCursorPos={setCursorPos}
        inputRef={inputRef}
        isConnected={isConnected}
        dmId={dmId}
        username={username}
        editingMessage={editingMessage}
        onCancelEditing={cancelEditing}
        replyTarget={replyTarget}
        onCancelReplying={cancelReplying}
        sheetOpen={sheetOpen}
        onCloseSheet={closeSheet}
        setEmojiOpen={setEmojiOpen}
        setGifOpen={setGifOpen}
        composerPreviewActiveUrl={composerPreviewActiveUrl}
        composerPreviewQuery={composerPreviewQuery}
        onDismissLinkPreview={(url) => setComposerPreviewDismissedFor(url)}
        onSendTextMessage={handleSendMessage}
        sendDirectMessage={sendDirectMessage}
        clearReplyTarget={clearReplyTarget}
        AnimatedMedia={AnimatedMedia}
        isGifUrl={isGifUrl}
        isEmojiOnly={isEmojiOnly}
        isVideoUrl={isVideoUrl}
        showToast={showToast}
      />

      {/* MessageActionSheet */}
      <MessageActionSheet
        open={sheetOpen && !actionModalOpen}
        onClose={closeSheet}
        mode="dm"
        username={username}
        uiKind={actionUiKind}
        message={sheetMessage}
        handlers={{
          onReply: handleReply,
          onCopy: handleCopy,
          onEdit: handleEdit,
          onDelete: handleDelete,
          onConfirmDelete: confirmDelete,
          onCancelDelete: cancelDeleteConfirmation,
        }}
        editDisabled={editDisabled}
        deleteDisabled={deleteDisabled}
        copyDisabled={copyDisabled}
        editKindBlocked={editKindBlocked}
        isGifUrl={isGifUrl}
        isVideoUrl={isVideoUrl}
        AnimatedMedia={AnimatedMedia}
        quickReactions={{
          emojis: QUICK_REACTION_EMOJIS,
          onSelect: handleQuickReactionSelect,
          disabled: !sheetMessage,
        }}
      />

      <MessageActionModal
        open={actionModalOpen}
        onClose={closeAllActionSurfaces}
        mode="dm"
        username={username}
        anchorRect={actionAnchorRect}
        uiKind={actionUiKind}
        message={sheetMessage}
        handlers={{
          onReply: handleReply,
          onCopy: handleCopy,
          onEdit: handleEdit,
          onDelete: handleDelete,
          onConfirmDelete: confirmDelete,
          onCancelDelete: cancelDeleteConfirmation,
        }}
        editDisabled={editDisabled}
        deleteDisabled={deleteDisabled}
        copyDisabled={copyDisabled}
        editKindBlocked={editKindBlocked}
        isGifUrl={isGifUrl}
        isVideoUrl={isVideoUrl}
        AnimatedMedia={AnimatedMedia}
        quickReactions={{
          emojis: QUICK_REACTION_EMOJIS,
          onSelect: handleQuickReactionSelect,
          disabled: !sheetMessage,
        }}
      />

      {/* Overlays */}
      <FullscreenOverlay isOpen={emojiOpen} onClose={() => setEmojiOpen(false)}>
        <EmojiPickerPage onClose={() => setEmojiOpen(false)} />
      </FullscreenOverlay>
      <FullscreenOverlay isOpen={gifOpen} onClose={() => setGifOpen(false)}>
        <GifPickerPage onClose={() => setGifOpen(false)} />
      </FullscreenOverlay>
    </div>
  );
};

export default PrivateChatPage;

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
