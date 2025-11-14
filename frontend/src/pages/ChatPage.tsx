import React, {
  Suspense,
  useState,
  useEffect,
  useRef,
  useReducer,
  useCallback,
} from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowLeft } from "@phosphor-icons/react";
import { routeStartsWith } from "../utils/routes.ts";
import FloatingActionButton from "../components/ui/FloatingActionButton";
import { ArrowDownIcon } from "../components/ui/icons";
import { useAuthStore } from "../stores/authStore";
import { useGroupStore } from "../stores/groupStore";
import { useSocketStore } from "../stores/socketStore";
import { useMessageStore } from "../stores/messageStore";
import { useComposerStore } from "../stores/composerStore";
import {
  useMessageFilterStore,
  type FilterEntry,
} from "../stores/messageFilterStore";
// removed direct fallback fetch; messages now come via React Query and sockets
import {
  useGroupMessagesQuery,
  messagesKey,
} from "../hooks/useGroupMessagesQuery";
import type { Message, ReactionEmoji } from "../types";
// BottomSheet usage refactored into MessageActionSheet
import MessageActionSheet from "../components/chat/MessageActionSheet";
import MessageActionModal from "../components/chat/MessageActionModal";
import FullscreenOverlay from "../components/ui/FullscreenOverlay";
import "./ChatPage.css";
// Bubble colors are now a single gray for all messages (generator removed)
import { useNotificationStore } from "../stores/notificationStore";
import { useAvatarStore } from "../stores/avatarStore";
import { useUiStore } from "../stores/uiStore";
import { navigateToUserProfile } from "../lib/userIdentity";
import SlidingHeader from "../components/common/SlidingHeader";
import type { MediaPreviewMeta } from "../components/common/MediaUpload";
import {
  collectVideoUrls,
  prefetchMediaBlob,
} from "../hooks/useCachedMediaBlob";
import ComposerPanel, {
  type ComposerPanelHandle,
} from "./chat/components/ComposerPanel";
import GroupMessageList from "./chat/components/GroupMessageList";
import FilteredUsersOverlay from "./chat/components/FilteredUsersOverlay";
import { OverlaySuspenseFallback } from "./chat/asyncComponents";
import ReactionDrawer from "../components/ReactionDrawer";
import DropDown from "../components/common/DropDown";
import EmojiPickerPage from "./EmojiPickerPage";
import GifPickerPage from "./GifPickerPage";
import {
  runWhenIdle,
  normalizeUsernameKey,
  coerceTimestampValueToMs,
} from "./chat/utils";
import {
  QUICK_REACTION_EMOJIS,
  UNIFIED_BUBBLE_BG,
  UNIFIED_BUBBLE_FG,
} from "./chat/chatConstants";
import { fetchGroupById } from "../services/api";
import { isSystemMessage, systemDisplayText } from "./chat/systemMessages";
import AnimatedMedia, {
  isGifOnlyMessage,
  isGifUrl,
  isMediaAttachmentMessage,
  isVideoUrl,
  isVoiceNoteMessage,
} from "./chat/media";
import type { SuppressedWindow } from "./chat/types";

const ChatPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { username, joined, hydrated } = useAuthStore();
  const avatarMap = useAvatarStore((s) => s.avatars);
  const ensureManyAvatars = useAvatarStore((s) => s.ensureMany);
  // removed unused myUserId
  const { currentGroup, setCurrentGroup } = useGroupStore();
  const { roomId } = useParams<{ roomId: string }>();
  const activeRoomId = (roomId || "").trim();
  const {
    isConnected,
    ensureConnected,
    joinGroup,
    leaveGroup,
    // sendMessage removed (we call via getState())
    joinedGroupIds,
    setActiveGroup,
    reactToMessage,
  } = useSocketStore();
  const socketInstance = useSocketStore((s) => s.socket);
  // removed unused reactToMessage getter
  const messages = useMessageStore((s) => s.messages);
  const setMessages = useMessageStore((s) => s.setMessages);
  const pruneUserMessagesBetween = useMessageStore(
    (s) => s.pruneUserMessagesBetween
  );
  const filteredByGroup = useMessageFilterStore((s) => s.filteredByGroup);
  const hydrateFiltersForGroup = useMessageFilterStore((s) => s.hydrateGroup);
  const addFilter = useMessageFilterStore((s) => s.addFilter);
  const removeFilter = useMessageFilterStore((s) => s.removeFilter);
  const isUserFiltered = useMessageFilterStore((s) => s.isFiltered);
  const showToast = useUiStore((s) => s.showToast);
  const finishRouteLoading = useUiStore((s) => s.finishRouteLoading);
  const {
    setDraft: setMessageInput,
    resetDraft,
    replyTarget,
    setReplyTarget,
    clearReplyTarget,
    setScope,
  } = useComposerStore();

  // removed groupInfo state (header description no longer used)
  const [groupMenuOpen, setGroupMenuOpen] = useState(false); // NEW: Group menu state
  const [filterModalUser, setFilterModalUser] = useState<string | null>(null);
  const [filteredUsersOpen, setFilteredUsersOpen] = useState(false);
  const [removingFilter, setRemovingFilter] = useState<string | null>(null);
  const suppressedWindowsRef = React.useRef<
    Map<string, Map<string, SuppressedWindow[]>>
  >(new Map());
  const [suppressedVersion, bumpSuppressedVersion] = React.useReducer(
    (value: number) => value + 1,
    0
  );

  // NEW: Reactions Drawer state
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [reactionsMessage, setReactionsMessage] = useState<Message | null>(
    null
  );
  // NEW: overlay states
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);

  // REMOVE: editingMessage state (handled by union)
  // const [editingMessage, setEditingMessage] = useState<Message | null>(null);

  const composerRef = useRef<ComposerPanelHandle | null>(null);
  // Add back the end-of-list anchor ref
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Track the last "my message" we've seen to avoid scrolling on mount/group switch
  const myLastKeyRef = useRef<string | number | null>(null);
  const isExplicitLeave = useRef(false);
  // removed triedFallback; no longer used
  const menuRef = useRef<HTMLDivElement | null>(null); // NEW: Menu ref
  const scrollRef = useRef<HTMLDivElement>(null); // NEW: Scroll container ref
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const lastScrollTopRef = useRef<number>(0);

  // NEW: refs map for each message row + highlighted key
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (!activeRoomId) {
      navigate("/", { replace: true });
      return;
    }

    if (
      currentGroup?.id === activeRoomId ||
      currentGroup?.databaseId === activeRoomId
    ) {
      return;
    }

    const storeSnapshot = useGroupStore.getState();
    const existing =
      storeSnapshot.groups.find(
        (g) => g.id === activeRoomId || g.databaseId === activeRoomId
      ) ||
      (storeSnapshot.currentGroup &&
      (storeSnapshot.currentGroup.id === activeRoomId ||
        storeSnapshot.currentGroup.databaseId === activeRoomId)
        ? storeSnapshot.currentGroup
        : null);

    if (existing) {
      setCurrentGroup(existing);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const fetched = await fetchGroupById(activeRoomId);
        if (cancelled) return;
        setCurrentGroup(fetched);
        useGroupStore.setState((state) => {
          const idx = state.groups.findIndex(
            (g) =>
              g.id === fetched.id ||
              (!!g.databaseId &&
                (g.databaseId === fetched.databaseId ||
                  g.databaseId === fetched.id ||
                  fetched.databaseId === g.id))
          );
          if (idx === -1) {
            return { groups: [...state.groups, fetched] };
          }
          const next = state.groups.slice();
          next[idx] = { ...next[idx], ...fetched };
          return { groups: next };
        });
      } catch (error) {
        if (cancelled) return;
        showToast("Unable to find that room", 2400);
        navigate("/", { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeRoomId,
    currentGroup?.id,
    currentGroup?.databaseId,
    navigate,
    setCurrentGroup,
    showToast,
  ]);

  // Ensure composer state is scoped per room to avoid bleed into DMs or other rooms
  useEffect(() => {
    if (currentGroup) {
      setScope(`group:${currentGroup.id}`);
    } else {
      setScope("group:");
    }
  }, [currentGroup?.id, location.pathname]);

  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const handleMentionNavigate = useCallback(
    (targetUsername: string) => {
      const sanitized = targetUsername.trim();
      if (!sanitized) return;
      void navigateToUserProfile(navigate, { username: sanitized });
    },
    [navigate]
  );

  // Header hide/show behavior handled by SlidingHeader

  // Unified bubble color: return the same gray for every message
  function getColorForMessage(_m: Message): { bg: string; fg: string } {
    return { bg: UNIFIED_BUBBLE_BG, fg: UNIFIED_BUBBLE_FG };
  }

  // Guard with hydration: only redirect after auth is hydrated to avoid flicker on refresh
  useEffect(() => {
    if (!hydrated) return; // wait for persisted auth to rehydrate

    const cancelIdle = runWhenIdle(
      () => {
        if (!joined || !currentGroup) {
          navigate("/", { replace: true });
          return;
        }
        ensureConnected();
      },
      { timeout: 150, fallbackDelay: 16 }
    );

    return () => {
      cancelIdle();
      if (currentGroup && isExplicitLeave.current) {
        leaveGroup(currentGroup.id);
        isExplicitLeave.current = false;
      }
    };
  }, [hydrated, joined, currentGroup, navigate, ensureConnected, leaveGroup]);

  // Join & activate on connect / group change
  useEffect(() => {
    if (!currentGroup || !isConnected) return;

    const cancelIdle = runWhenIdle(
      () => {
        joinGroup(currentGroup.id, currentGroup.name);
        setActiveGroup(currentGroup.id);
      },
      { timeout: 180, fallbackDelay: 24 }
    );

    return cancelIdle;
  }, [isConnected, currentGroup, joinGroup, setActiveGroup]);

  useEffect(() => {
    const gid = currentGroup?.id;
    if (!gid) return;
    void hydrateFiltersForGroup(gid);
  }, [currentGroup?.id, hydrateFiltersForGroup]);

  // Refresh user list if reconnected
  useEffect(() => {
    if (isConnected && currentGroup && joinedGroupIds.has(currentGroup.id)) {
      joinGroup(currentGroup.id, currentGroup.name);
    }
  }, [isConnected, currentGroup, joinedGroupIds, joinGroup]);

  // React Query: fetch messages for active group; seed store immediately
  const msgQuery = useGroupMessagesQuery(currentGroup?.id, !!currentGroup);

  useEffect(() => {
    if (!msgQuery.isLoading && !msgQuery.isFetching) {
      finishRouteLoading();
    }
  }, [msgQuery.isLoading, msgQuery.isFetching, finishRouteLoading]);
  useEffect(() => {
    if (!currentGroup) return;
    const list = messages[currentGroup.id] || [];
    if (list.length > 0) return; // already have messages
    if (Array.isArray(msgQuery.data) && msgQuery.data.length > 0) {
      setMessages(currentGroup.id, msgQuery.data);
    }
  }, [currentGroup?.id, msgQuery.data, messages, setMessages]);

  // REMOVE this effect to disable all auto-scroll
  // useEffect(() => {
  //   messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  // }, [messages, currentGroup?.id]);

  const currentMessages = currentGroup ? messages[currentGroup.id] || [] : [];

  const filterEntriesForGroup = React.useMemo<FilterEntry[]>(() => {
    if (!currentGroup?.id) return [];
    return filteredByGroup[currentGroup.id] || [];
  }, [currentGroup?.id, filteredByGroup]);

  const filteredUsernamesForGroup = React.useMemo(
    () => filterEntriesForGroup.map((entry) => entry.username),
    [filterEntriesForGroup]
  );

  const filterThresholdByUser = React.useMemo(() => {
    const map = new Map<string, number>();
    const now = Date.now();
    for (const entry of filterEntriesForGroup) {
      const normalized =
        normalizeUsernameKey(entry.normalized) ||
        normalizeUsernameKey(entry.username);
      if (!normalized) continue;
      const maybeSince = coerceTimestampValueToMs(entry.createdAt);
      const since = Number.isFinite(maybeSince) ? (maybeSince as number) : now;
      map.set(normalized, since);
    }
    return map;
  }, [filterEntriesForGroup]);

  const registerSuppressedWindow = React.useCallback(
    (groupId: string, username: string, startMs: number, endMs: number) => {
      const safeGroup = (groupId || "").trim();
      const normalizedUser = normalizeUsernameKey(username);
      if (!safeGroup || !normalizedUser) return;
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return;
      if (endMs <= startMs) return;

      let groupMap = suppressedWindowsRef.current.get(safeGroup);
      if (!groupMap) {
        groupMap = new Map<string, SuppressedWindow[]>();
        suppressedWindowsRef.current.set(safeGroup, groupMap);
      }

      const normalizedStart = Math.floor(startMs);
      const normalizedEnd = Math.floor(endMs);
      if (
        !Number.isFinite(normalizedStart) ||
        !Number.isFinite(normalizedEnd)
      ) {
        return;
      }
      if (normalizedEnd <= normalizedStart) return;

      const existing = groupMap.get(normalizedUser) || [];
      const candidateWindows = [
        ...existing.map((win) => ({ ...win })),
        { start: normalizedStart, end: normalizedEnd },
      ].filter((win) => win.end > win.start);

      if (!candidateWindows.length) {
        if (groupMap.delete(normalizedUser)) {
          bumpSuppressedVersion();
        }
        return;
      }

      candidateWindows.sort((a, b) => a.start - b.start);
      const merged: SuppressedWindow[] = [];
      for (const win of candidateWindows) {
        if (!merged.length) {
          merged.push({ ...win });
          continue;
        }
        const last = merged[merged.length - 1];
        if (win.start <= last.end) {
          last.end = Math.max(last.end, win.end);
        } else {
          merged.push({ ...win });
        }
      }

      const previous = groupMap.get(normalizedUser) || [];
      const unchanged =
        previous.length === merged.length &&
        previous.every(
          (win, idx) =>
            win.start === merged[idx].start && win.end === merged[idx].end
        );
      if (unchanged) return;

      groupMap.set(normalizedUser, merged);
      suppressedWindowsRef.current.set(safeGroup, groupMap);
      bumpSuppressedVersion();
    },
    [bumpSuppressedVersion]
  );

  const findFilterEntryForUser = React.useCallback(
    (targetUsername: string): FilterEntry | null => {
      const normalizedTarget = normalizeUsernameKey(targetUsername);
      if (!normalizedTarget) return null;
      return (
        filterEntriesForGroup.find((entry) => {
          const normalizedEntry =
            normalizeUsernameKey(entry.normalized) ||
            normalizeUsernameKey(entry.username);
          return normalizedEntry === normalizedTarget;
        }) ?? null
      );
    },
    [filterEntriesForGroup]
  );

  useEffect(() => {
    if (!currentGroup?.id) {
      setFilterModalUser(null);
      setFilteredUsersOpen(false);
    }
  }, [currentGroup?.id]);

  useEffect(() => {
    if (!currentGroup?.id) return;
    const groupId = currentGroup.id;
    const suppressed = suppressedWindowsRef.current.get(groupId);
    if (!suppressed || suppressed.size === 0) return;
    for (const [normalizedUser, windows] of suppressed.entries()) {
      for (const window of windows) {
        pruneUserMessagesBetween(
          groupId,
          normalizedUser,
          window.start,
          window.end
        );
      }
    }
  }, [currentGroup?.id, messages, pruneUserMessagesBetween, suppressedVersion]);

  const filterModalOpen = filterModalUser !== null;
  const filterModalTarget = filterModalUser ?? "";

  const filterModalIsActive = React.useMemo(() => {
    if (!filterModalUser || !currentGroup?.id) return false;
    return isUserFiltered(currentGroup.id, filterModalUser);
  }, [
    currentGroup?.id,
    filterModalUser,
    isUserFiltered,
    filteredUsernamesForGroup,
  ]);

  const closeFilterModal = React.useCallback(() => {
    setFilterModalUser(null);
  }, []);

  const openFilterModal = React.useCallback((targetUsername: string) => {
    if (!targetUsername) return;
    const trimmed = targetUsername.trim();
    setFilterModalUser(trimmed || targetUsername);
  }, []);

  const handleConfirmFilterChoice = React.useCallback(async () => {
    if (!filterModalUser || !currentGroup?.id) {
      setFilterModalUser(null);
      return;
    }
    const finalName = filterModalUser.trim() || filterModalUser;
    if (!finalName) {
      setFilterModalUser(null);
      return;
    }

    let success = false;
    if (filterModalIsActive) {
      const targetEntry = findFilterEntryForUser(finalName);
      const removalStart = targetEntry
        ? coerceTimestampValueToMs(targetEntry.createdAt)
        : null;
      success = await removeFilter(currentGroup.id, finalName);
      if (success) {
        showToast(`Showing messages from ${finalName} again.`, 2200, "success");
        if (Number.isFinite(removalStart)) {
          const removalAt = Date.now();
          registerSuppressedWindow(
            currentGroup.id,
            finalName,
            removalStart as number,
            removalAt
          );
          pruneUserMessagesBetween(
            currentGroup.id,
            finalName,
            removalStart as number,
            removalAt
          );
        }
      }
    } else {
      success = await addFilter(currentGroup.id, finalName);
      if (success) {
        showToast(`Filtering messages from ${finalName}.`, 2200, "neutral");
      }
    }

    if (success) {
      socketInstance?.emit("filters:refresh", {
        groupId: currentGroup.id,
        includeHistory: true,
      });
    } else {
      showToast(
        "Couldn't update message filters. Please try again.",
        2600,
        "error"
      );
    }
    setFilterModalUser(null);
  }, [
    addFilter,
    currentGroup?.id,
    findFilterEntryForUser,
    filterModalIsActive,
    filterModalUser,
    pruneUserMessagesBetween,
    registerSuppressedWindow,
    removeFilter,
    socketInstance,
    showToast,
  ]);

  const handleRemoveFilterEntry = React.useCallback(
    async (entry: FilterEntry) => {
      if (!currentGroup?.id) return;
      const target = (entry.username || "").trim();
      if (!target) return;
      const normalizedTarget = normalizeUsernameKey(target);
      setRemovingFilter(normalizedTarget);
      try {
        const removalStart = coerceTimestampValueToMs(entry.createdAt);
        const success = await removeFilter(currentGroup.id, target);
        if (success) {
          showToast(`Showing messages from ${target} again.`, 2200, "success");
          if (Number.isFinite(removalStart)) {
            const removalAt = Date.now();
            registerSuppressedWindow(
              currentGroup.id,
              target,
              removalStart as number,
              removalAt
            );
            pruneUserMessagesBetween(
              currentGroup.id,
              target,
              removalStart as number,
              removalAt
            );
          }
          socketInstance?.emit("filters:refresh", {
            groupId: currentGroup.id,
            includeHistory: true,
          });
        } else {
          showToast(
            "Couldn't update message filters. Please try again.",
            2600,
            "error"
          );
        }
      } finally {
        setRemovingFilter(null);
      }
    },
    [
      currentGroup?.id,
      pruneUserMessagesBetween,
      registerSuppressedWindow,
      removeFilter,
      showToast,
      socketInstance,
    ]
  );

  const resolveMediaOverlayMeta = React.useCallback(
    (message: Message): MediaPreviewMeta | undefined => {
      if (!message) return undefined;
      const structuredMedia =
        ((message as any).kind === "media" &&
          Boolean((message as any).media?.original)) ||
        false;
      if (!structuredMedia) return undefined;

      const username = message.username;
      if (!username) return undefined;
      const lower = username.toLowerCase?.() ?? username;
      const explicitAvatar = (message as any).avatar;
      const resolvedAvatar =
        (typeof explicitAvatar === "string" && explicitAvatar) ||
        (typeof avatarMap[lower] === "string" ? avatarMap[lower] : null);

      const rawTimestamp =
        (message as any).timestamp ??
        (message as any).createdAt ??
        (message as any).sentAt ??
        (message as any).created_at ??
        null;

      const normalizedTimestamp = (() => {
        if (rawTimestamp == null) return null;
        if (rawTimestamp instanceof Date) return rawTimestamp.getTime();
        if (typeof rawTimestamp === "number") {
          return rawTimestamp < 1_000_000_000_000
            ? rawTimestamp * 1000
            : rawTimestamp;
        }
        if (typeof rawTimestamp === "string") {
          const numeric = Number(rawTimestamp);
          if (Number.isFinite(numeric)) {
            return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
          }
          const parsed = Date.parse(rawTimestamp);
          if (Number.isFinite(parsed)) return parsed;
          return rawTimestamp;
        }
        return null;
      })();

      return {
        username,
        avatarUrl: resolvedAvatar ?? undefined,
        timestamp: normalizedTimestamp,
      };
    },
    [avatarMap]
  );

  // Dedupe consecutive identical system messages within a short time window
  const renderMessages = React.useMemo(() => {
    if (!currentGroup) return [] as Message[];
    const list = messages[currentGroup.id] || [];
    const MAX_WINDOW = 250; // keep recent 250 to limit DOM
    const start = list.length > MAX_WINDOW ? list.length - MAX_WINDOW : 0;
    const windowed = list.slice(start);
    const out: Message[] = [];
    let lastSysText: string | null = null;
    let lastSysAt = 0;
    const WINDOW_MS = 7000; // collapse identical system notices within 7s
    const thresholds = filterThresholdByUser;
    const suppressedForGroup =
      suppressedWindowsRef.current.get(currentGroup.id) || null;

    const toMillis = (t: unknown): number => {
      if (t instanceof Date) return t.getTime();
      if (typeof t === "number") return t < 1e12 ? t * 1000 : t;
      if (typeof t === "string") {
        const n = Number(t);
        if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
        const p = Date.parse(t);
        return Number.isFinite(p) ? p : 0;
      }
      return 0;
    };

    const extractMessageTimestamp = (message: Message): number => {
      const candidate =
        (message as any).timestamp ??
        (message as any).createdAt ??
        (message as any).sentAt ??
        (message as any).created_at ??
        (message as any).meta?.createdAt ??
        null;
      if (candidate == null) return Number.MAX_SAFE_INTEGER;
      const ms = toMillis(candidate);
      return Number.isFinite(ms) && ms > 0 ? ms : Number.MAX_SAFE_INTEGER;
    };

    for (const m of windowed) {
      const isSystem = isSystemMessage(m as any);
      let cachedTimestamp: number | null = null;
      const ensureTimestamp = () => {
        if (cachedTimestamp === null) {
          cachedTimestamp = extractMessageTimestamp(m);
        }
        return cachedTimestamp;
      };

      if (!isSystem) {
        const normalized = normalizeUsernameKey(m.username);
        if (normalized) {
          const cutoff = thresholds.get(normalized);
          if (cutoff != null) {
            const messageTs = ensureTimestamp();
            if (messageTs >= cutoff) {
              continue;
            }
          }
          const windows = suppressedForGroup?.get(normalized);
          if (windows && windows.length) {
            const messageTs = ensureTimestamp();
            const hidden = windows.some(
              (window) => messageTs >= window.start && messageTs < window.end
            );
            if (hidden) {
              continue;
            }
          }
        }
      }

      if (isSystem) {
        const text = systemDisplayText(m as any);
        const at = toMillis((m as any).timestamp);
        const same =
          lastSysText &&
          text === lastSysText &&
          at &&
          Math.abs(at - lastSysAt) <= WINDOW_MS;
        if (same) continue; // skip duplicate system notice
        lastSysText = text;
        lastSysAt = at;
      } else {
        lastSysText = null;
        lastSysAt = 0;
      }
      out.push(m);
    }
    return out;
  }, [currentGroup?.id, messages, filterThresholdByUser, suppressedVersion]);

  const queryClient = useQueryClient();

  useEffect(() => {
    const gid = currentGroup?.id?.trim();
    if (!gid) return;
    queryClient.setQueryData(messagesKey(gid), currentMessages);
  }, [currentGroup?.id, currentMessages, queryClient]);

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
      prefetchMediaBlob(queryClient, url).catch(() => {});
    });
  }, [renderMessages, queryClient]);

  // Ensure Cloudinary avatars for participants in the currently rendered window
  useEffect(() => {
    if (!renderMessages.length) return;
    const names = Array.from(
      new Set(
        renderMessages
          .map((m) => (m?.username || "").trim())
          .filter((u) => !!u && u.toLowerCase() !== "system")
      )
    );
    if (names.length) ensureManyAvatars(names);
  }, [renderMessages, ensureManyAvatars]);

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

  const handleReactionCountClick = useCallback((message: Message) => {
    setReactionsMessage(message);
    setReactionsOpen(true);
  }, []);

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

  const keyFor = (m: any, i?: number) => {
    if (m?.messageId) return `id:${m.messageId}`;
    const u = typeof m?.username === "string" ? m.username : "";
    const t = m?.timestamp ?? "";
    if (u && t) return `ts:${u}|${t}`;
    // Fallback to a stable-ish key within this render to avoid duplicates
    return `auto:${i ?? 0}`;
  };

  // removed unused sheetMsgKey

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
    composerRef.current?.ensureRecordingPaused();
    const from = (location.state as any)?.from as string | undefined;
    if (from === "/inbox") {
      navigate("/inbox");
      return;
    }
    if (from === "/") {
      navigate("/");
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
    navigate("/");
  };

  const handleLeaveRoom = () => {
    composerRef.current?.ensureRecordingPaused();
    if (currentGroup) {
      isExplicitLeave.current = true;
      leaveGroup(activeRoomId);
      setCurrentGroup(null);
      navigate("/", { replace: true });
    }
  };

  // -------------------------
  // Handlers (updated)
  // -------------------------
  const closeSheet = useCallback(() => {
    dispatchUI({ type: "CLOSE_SHEET" });
  }, [dispatchUI]);

  const openActionsFor = useCallback(
    (m: Message) => {
      dispatchUI({ type: "OPEN_ACTIONS", message: m });
    },
    [dispatchUI]
  );

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
      try {
        reactToMessage(sheetMessage, emoji);
      } finally {
        closeAllActionSurfaces();
      }
    },
    [sheetMessage, reactToMessage, closeAllActionSurfaces]
  );

  const handleQuickReact = useCallback(
    (message: Message) => {
      const emoji = QUICK_REACTION_EMOJIS[0] ?? "❤️";
      try {
        reactToMessage(message, emoji);
      } catch {
        // ignore reaction errors; the action sheet remains as a fallback
      }
    },
    [reactToMessage]
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
        composerRef.current?.focusComposer();
      }, 50);
    },
    [setReplyTarget]
  );

  const handleReply = () => {
    if (sheetMessage) {
      focusComposerForReply(sheetMessage);
    }
    closeAllActionSurfaces();
  };

  // NEW: Mention handler — inserts "@username " at the caret and focuses input
  const handleMention = useCallback(() => {
    if (!sheetMessage) {
      closeAllActionSurfaces();
      return;
    }
    const target = sheetMessage.username?.trim();
    if (!target) {
      closeAllActionSurfaces();
      return;
    }

    composerRef.current?.insertMention(target);
    closeAllActionSurfaces();
  }, [sheetMessage, closeAllActionSurfaces]);

  const handleQuickMention = useCallback((targetUsername: string) => {
    composerRef.current?.insertMention(targetUsername);
  }, []);

  const isMentionable = useCallback(
    (author?: string | null) => {
      const self = typeof username === "string" ? username.trim() : "";
      const target = typeof author === "string" ? author.trim() : "";
      if (!self || !target) return false;
      return self.toLowerCase() !== target.toLowerCase();
    },
    [username]
  );

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
      setTimeout(() => composerRef.current?.focusComposer(), 40);
    }
    closeAllActionSurfaces();
  };

  const confirmDelete = () => {
    if (sheetMessage) {
      useSocketStore.getState().deleteMessage(sheetMessage);
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

  const handleVoiceNoteDuration = React.useCallback(
    (msg: Message, durationMs: number) => {
      if (!currentGroup) return;
      const sanitized = Math.max(0, Math.round(durationMs));
      if (!sanitized) return;
      try {
        useMessageStore
          .getState()
          .setAudioDuration(currentGroup.id, msg, sanitized);
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
        if (matches) {
          composer.setReplyTarget(msg as any);
        }
      } catch {}
    },
    [currentGroup]
  );

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
    const isChatRoute = routeStartsWith(location.pathname, "/chat");
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

  // Members count removed from DropDown; no need to compute here

  const lastGroupIdRef = useRef<string | null>(null);

  // Virtualizer setup for very long conversations
  const useVirtual = renderMessages.length > 400; // threshold for virtualization
  const virtualizer = useVirtual
    ? useVirtualizer({
        count: renderMessages.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => 84,
        overscan: 12,
      })
    : null;

  // FAB visibility follows scroll direction: show on downward scroll, hide on upward scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    lastScrollTopRef.current = el.scrollTop;
    setShowScrollToBottom(false);

    const handleScroll = () => {
      const current = el.scrollTop;
      const previous = lastScrollTopRef.current;
      const remaining = el.scrollHeight - (current + el.clientHeight);
      const atBottom = remaining <= 8;

      if (atBottom) {
        setShowScrollToBottom(false);
      } else if (current > previous + 2) {
        setShowScrollToBottom(true);
      } else if (current < previous - 2) {
        setShowScrollToBottom(false);
      }

      lastScrollTopRef.current = current;
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", handleScroll);
    };
  }, [currentGroup?.id, useVirtual]);

  const scrollToBottom = React.useCallback(() => {
    if (useVirtual && virtualizer) {
      const last = renderMessages.length - 1;
      if (last >= 0) virtualizer.scrollToIndex(last, { align: "end" });
    } else {
      const el = scrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      else messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    // Hide FAB immediately after jumping to bottom and sync scroll baseline
    setShowScrollToBottom(false);
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) {
        lastScrollTopRef.current = el.scrollTop;
      }
    });
  }, [useVirtual, virtualizer, renderMessages.length]);

  // Reset FAB state when switching rooms
  useEffect(() => {
    const groupId = currentGroup?.id ?? null;
    const prevGroupId = lastGroupIdRef.current;
    const groupChanged = groupId !== prevGroupId && groupId !== null;

    lastGroupIdRef.current = groupId;

    if (!groupChanged) return;

    setShowScrollToBottom(false);

    if (useVirtual && virtualizer) {
      const last = renderMessages.length - 1;
      if (last >= 0) virtualizer.scrollToIndex(last, { align: "end" });
    } else {
      requestAnimationFrame(() =>
        messagesEndRef.current?.scrollIntoView({ behavior: "auto" })
      );
    }

    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) {
        lastScrollTopRef.current = el.scrollTop;
      }
    });
  }, [currentGroup?.id, renderMessages.length, useVirtual, virtualizer]);

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
      if (useVirtual && virtualizer) {
        const last = renderMessages.length - 1;
        if (last >= 0) virtualizer.scrollToIndex(last, { align: "end" });
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    }
  }, [myLatestMsgKey, useVirtual, virtualizer, renderMessages.length]);

  // NEW: scroll-to-referenced helper (for reply previews)
  const scrollToReferenced = React.useCallback(
    (reply: {
      messageId?: string;
      username: string;
      timestamp?: string | number | null;
    }) => {
      if (!currentGroup) return;
      const list = messages[currentGroup.id] || [];

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

      // Virtualized path: if item is visible, don't scroll; otherwise scroll+highlight
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
          if (!isVisible) {
            virtualizer.scrollToIndex(idx, { align: "center" });
          }
        }
        return;
      }

      // Non-virtualized path: check visibility within scroll container
      const el = messageRefs.current.get(k);
      const container = scrollRef.current;
      const isInView = (node: HTMLDivElement) => {
        if (!container) return false;
        const cRect = container.getBoundingClientRect();
        const nRect = node.getBoundingClientRect();
        const margin = 6; // small padding to avoid edges
        return (
          nRect.top >= cRect.top + margin &&
          nRect.bottom <= cRect.bottom - margin
        );
      };
      const doAct = (node?: HTMLDivElement) => {
        if (!node) return;
        if (!isInView(node)) {
          node.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        setHighlightedKey(k);
        window.setTimeout(() => setHighlightedKey(null), 1600);
      };
      if (el) doAct(el);
      else requestAnimationFrame(() => doAct(messageRefs.current.get(k)));
    },
    [currentGroup, messages, useVirtual, virtualizer, renderMessages]
  );

  return (
    <div className="flex flex-col h-screen">
      <SlidingHeader
        scrollRef={scrollRef}
        className="bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/70"
        innerClassName="chat-header-content justify-between px-3 h-14"
        setCssVarName="--app-header-h"
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
              </h1>
            </div>
          </div>
        </div>

        {/* Right-side actions: Menu (Share moved into DropDown) */}
        <div className="flex items-center gap-4">
          <DropDown
            onLeaveRoom={handleLeaveRoom}
            buttonClassName="text-gray-900"
            groupId={currentGroup?.databaseId || currentGroup?.id}
            groupName={currentGroup?.name}
            onOpenFilteredUsers={() => setFilteredUsersOpen(true)}
            offset={{ mainAxis: 16 }}
            openAnimation="slide-from-top"
          />
        </div>
      </SlidingHeader>

      <GroupMessageList
        scrollRef={scrollRef}
        messagesEndRef={messagesEndRef}
        messageRefs={messageRefs}
        renderMessages={renderMessages}
        useVirtual={useVirtual}
        virtualizer={virtualizer}
        highlightedKey={highlightedKey}
        currentGroupId={currentGroup?.id}
        username={username}
        avatarMap={avatarMap}
        keyFor={keyFor}
        getColorForMessage={getColorForMessage}
        handleMentionNavigate={handleMentionNavigate}
        isMentionable={isMentionable}
        handleQuickMention={handleQuickMention}
        openFilterModal={openFilterModal}
        openActionsFor={openActionsFor}
        openModalFor={openActionModal}
        onQuickReact={handleQuickReact}
        scrollToReferenced={scrollToReferenced}
        handleVoiceNoteDuration={handleVoiceNoteDuration}
        resolveMediaOverlayMeta={resolveMediaOverlayMeta}
        onReactionCountClick={handleReactionCountClick}
        isConnected={isConnected}
        isEmojiOnly={isEmojiOnly}
        onSwipeReply={handleSwipeReply}
      />

      <ComposerPanel
        ref={composerRef}
        isConnected={isConnected}
        currentGroup={currentGroup}
        username={username}
        editingMessage={editingMessage}
        replyTarget={replyTarget}
        sheetOpen={sheetOpen}
        onRequestCloseSheet={closeSheet}
        onOpenEmojiPicker={() => setEmojiOpen(true)}
        onOpenGifPicker={() => setGifOpen(true)}
        onCancelEditing={cancelEditing}
        onCancelReplying={cancelReplying}
      />

      {/* Scroll-to-bottom FAB */}
      <FloatingActionButton
        onClick={scrollToBottom}
        show={showScrollToBottom}
        ariaLabel="Scroll to latest messages"
        title="Jump to bottom"
      >
        <ArrowDownIcon />
      </FloatingActionButton>

      {/* MessageActionSheet */}
      <MessageActionSheet
        open={sheetOpen && !actionModalOpen}
        onClose={closeSheet}
        mode="group"
        username={username}
        uiKind={actionUiKind}
        message={sheetMessage}
        handlers={{
          onReply: handleReply,
          onMention: handleMention,
          onCopy: handleCopy,
          onEdit: handleEdit,
          onDelete: handleDelete,
          onConfirmDelete: confirmDelete,
          onCancelDelete: cancelDeleteConfirmation,
        }}
        editDisabled={editDisabled}
        deleteDisabled={deleteDisabled}
        editKindBlocked={editKindBlocked}
        copyDisabled={copyDisabled}
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
        mode="group"
        username={username}
        anchorRect={actionAnchorRect}
        uiKind={actionUiKind}
        message={sheetMessage}
        handlers={{
          onReply: handleReply,
          onMention: handleMention,
          onCopy: handleCopy,
          onEdit: handleEdit,
          onDelete: handleDelete,
          onConfirmDelete: confirmDelete,
          onCancelDelete: cancelDeleteConfirmation,
        }}
        editDisabled={editDisabled}
        deleteDisabled={deleteDisabled}
        editKindBlocked={editKindBlocked}
        copyDisabled={copyDisabled}
        isGifUrl={isGifUrl}
        isVideoUrl={isVideoUrl}
        AnimatedMedia={AnimatedMedia}
        quickReactions={{
          emojis: QUICK_REACTION_EMOJIS,
          onSelect: handleQuickReactionSelect,
          disabled: !sheetMessage,
        }}
      />

      {/* Reactions Drawer */}
      {reactionsOpen && (
        <ReactionDrawer
          open
          onClose={() => setReactionsOpen(false)}
          message={reactionsMessage}
          title="People who reacted"
        />
      )}

      {/* Emoji Picker Overlay */}
      {emojiOpen && (
        <FullscreenOverlay isOpen onClose={() => setEmojiOpen(false)}>
          <Suspense fallback={<OverlaySuspenseFallback />}>
            <EmojiPickerPage onClose={() => setEmojiOpen(false)} />
          </Suspense>
        </FullscreenOverlay>
      )}

      {/* GIF Picker Overlay */}
      {gifOpen && (
        <FullscreenOverlay isOpen onClose={() => setGifOpen(false)}>
          <Suspense fallback={<OverlaySuspenseFallback />}>
            <GifPickerPage onClose={() => setGifOpen(false)} />
          </Suspense>
        </FullscreenOverlay>
      )}

      <FilteredUsersOverlay
        open={filteredUsersOpen}
        entries={filterEntriesForGroup}
        removingKey={removingFilter}
        onClose={() => setFilteredUsersOpen(false)}
        onShowOptions={(rawUsername) => {
          const next = rawUsername ? rawUsername.trim() || rawUsername : "";
          setFilteredUsersOpen(false);
          setFilterModalUser(next);
        }}
        onRemove={handleRemoveFilterEntry}
        filterModalOpen={filterModalOpen}
        filterModalTarget={filterModalTarget}
        filterModalIsActive={filterModalIsActive}
        onConfirmFilterChoice={handleConfirmFilterChoice}
        onCancelFilterChoice={closeFilterModal}
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
