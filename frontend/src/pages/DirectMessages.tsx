import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { useSocketStore } from "../stores/socketStore";
import { useNotificationStore } from "../stores/notificationStore";
import { useMessageStore } from "../stores/messageStore";
import DirectMessageCard from "../components/common/DirectMessageCard";
import LoadingSpinner from "../components/ui/LoadingSpinner";
import PageHeader from "../components/common/PageHeader";
import { peerFromDmId } from "../utils/direct";
import { useAvatarStore } from "../stores/avatarStore";
import BottomSheet from "../components/common/BottomSheet";
import { useUiStore } from "../stores/uiStore";
import { navigateToDmThread } from "../lib/userIdentity";
import type { Message } from "../types";
import { useDmThreadStore } from "../stores/dmThreadStore";
import { Trash } from "phosphor-react";
import { getAllPreviews, removePreview } from "../lib/previews";
import { getMessagesWindow, removeMessagesWindow } from "../lib/messagesCache";
import { fetchProfileByUsername } from "../services/api";

const DirectMessages: React.FC = () => {
  const navigate = useNavigate();
  const { joined, username } = useAuthStore();
  const { ensureConnected } = useSocketStore();
  const unreadByGroup = useNotificationStore((s) => s.unreadByGroup);
  const allMessages = useMessageStore((s) => s.messages);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const showToast = useUiStore((s) => s.showToast);
  const hideThread = useDmThreadStore((s) => s.hide);
  const getHiddenAt = useDmThreadStore((s) => s.getHiddenAt);
  const clearThread = useMessageStore((s) => s.clearThread);
  const resetUnread = useNotificationStore((s) => s.reset);

  // BottomSheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [target, setTarget] = useState<{ dmId: string; msg: Message } | null>(
    null
  );

  useEffect(() => {
    if (!joined) {
      navigate("/", { replace: true });
      return;
    }
    ensureConnected();
  }, [joined, ensureConnected, navigate]);

  // Hydrate cached DM previews for empty threads on first mount
  useEffect(() => {
    (async () => {
      try {
        const setMessages = useMessageStore.getState().setMessages;
        const msgs = useMessageStore.getState().messages;
        // Prefer full window of messages when available in IDB; otherwise fallback to a single preview
        // We don't know all DM ids from store if empty, so try a minimal fallback via previews
        const previews = await getAllPreviews();
        for (const p of previews) {
          const tid = String(p.threadId);
          if (!tid.startsWith("dm:")) continue;
          if ((msgs[tid] || []).length > 0) continue;
          const win = await getMessagesWindow(tid);
          if (win && win.length) {
            setMessages(tid, win as any);
            continue;
          }
          const m: any = {
            messageId: `preview:${tid}:${p.timestamp || Date.now()}`,
            username: p.username || "",
            text: p.text || (p.kind === "gif" ? "GIF" : ""),
            timestamp: p.timestamp || new Date().toISOString(),
          };
          setMessages(tid, [m]);
        }
      } catch {}
    })();
  }, []);

  type ThreadInfo = {
    dmId: string;
    peer: string;
    latestTs: number;
    unread: number;
    latestMessage?: Message;
  };

  const dmThreads = useMemo<ThreadInfo[]>(() => {
    const me = username || "";
    const toMs = (t: any): number => {
      if (t == null) return 0;
      if (typeof t === "number") return t > 0 && t < 1e12 ? t * 1000 : t;
      if (typeof t === "string") {
        const s = t.trim();
        if (!s) return 0;
        // numeric string?
        const n = Number(s);
        if (Number.isFinite(n) && n > 0) return n < 1e12 ? n * 1000 : n;
        // ISO or date-like string
        const p = Date.parse(s);
        return Number.isFinite(p) ? p : 0;
      }
      return 0;
    };
    const result: ThreadInfo[] = [];

    for (const key of Object.keys(allMessages)) {
      if (!key.startsWith("dm:")) continue;
      // Skip hidden threads unless there are new messages newer than hiddenAt
      const hiddenAt = getHiddenAt(key) ?? undefined;
      const list = (allMessages[key] || []) as Message[];
      if (!list.length) continue;

      // latest non-system, non-deleted from the end (for preview)
      let latest: Message | undefined = list[list.length - 1];
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i] as any;
        if (!m?.system && !m?.deleted) {
          latest = list[i] as Message;
          break;
        }
      }
      // For ordering, be robust: use the maximum timestamp we can find in the thread
      let maxTs = 0;
      for (let i = 0; i < list.length; i++) {
        const ts = toMs((list[i] as any)?.timestamp);
        if (ts > maxTs) maxTs = ts;
      }

      const rawPeerLc = peerFromDmId(key, me);
      // Try to get natural casing from the last message by the peer
      let displayPeer = rawPeerLc;
      const peerMsg = [...list]
        .reverse()
        .find((m: any) => (m?.username || "").toLowerCase() === rawPeerLc);
      if (peerMsg?.username) displayPeer = peerMsg.username;
      else if (rawPeerLc)
        displayPeer = rawPeerLc.charAt(0).toUpperCase() + rawPeerLc.slice(1);

      // If hidden and no message is newer than hiddenAt, continue
      if (hiddenAt != null && maxTs <= hiddenAt) {
        continue;
      }

      result.push({
        dmId: key,
        peer: displayPeer,
        latestTs: maxTs || toMs((latest as any)?.timestamp),
        unread: unreadByGroup[key] || 0,
        latestMessage: latest,
      });
    }

    result.sort((a, b) => b.latestTs - a.latestTs);
    return result;
  }, [allMessages, unreadByGroup, username]);

  // Prefetch avatars for all peers visible in the list
  const ensureMany = useAvatarStore((s) => s.ensureMany);
  useEffect(() => {
    if (dmThreads.length) {
      ensureMany(dmThreads.map((t) => t.peer));
    }
  }, [dmThreads, ensureMany]);

  const handleOpenDM = React.useCallback(
    async (peer: string, dmId: string) => {
      const username = peer?.trim();
      if (!username) return;
      const identity = await navigateToDmThread(navigate, {
        username,
        state: { from: "/direct", dmId },
      });
      if (!identity) {
        showToast("Couldn't open conversation.", 1600);
        return;
      }
      try {
        resetUnread(dmId);
      } catch {}
    },
    [navigate, resetUnread, showToast]
  );

  // Long-press to hide the DM thread (card) locally
  const handleLongPress = (dmId: string) => {
    // Determine the latest message timestamp to show a preview in sheet
    const list = (allMessages[dmId] || []) as Message[];
    let latest: Message | null = null;
    for (let i = list.length - 1; i >= 0; i--) {
      const m: any = list[i];
      if (m?.system) continue;
      latest = list[i];
      break;
    }
    if (!latest) latest = list[list.length - 1] || null;
    if (!latest) {
      showToast("Nothing to remove", 1600);
      return;
    }
    setTarget({ dmId, msg: latest });
    setSheetOpen(true);
  };

  const closeSheet = () => {
    setSheetOpen(false);
    // Defer clearing target till after animation ends to keep content mounted
    setTimeout(() => setTarget(null), 250);
  };

  // --- Lazy-loading for DM thread list ---
  const PAGE_SIZE = 20;
  const OBS_THRESHOLD = 0.25;
  const [visibleThreads, setVisibleThreads] = useState<ThreadInfo[]>(
    dmThreads.slice(0, PAGE_SIZE)
  );
  const [nextIndex, setNextIndex] = useState(
    Math.min(PAGE_SIZE, dmThreads.length)
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const hasMore = nextIndex < dmThreads.length;
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const peerStatusRef = useRef<
    Record<string, { status: "present" | "missing"; checkedAt: number }>
  >({});

  // Reset visible slice when dmThreads changes
  useEffect(() => {
    const initial = dmThreads.slice(0, PAGE_SIZE);
    setVisibleThreads(initial);
    setNextIndex(initial.length);
  }, [dmThreads]);

  useEffect(() => {
    if (!dmThreads.length) return;

    let cancelled = false;
    const TTL = 5 * 60 * 1000; // 5 minutes

    const pruneMissingPeers = async () => {
      for (const { peer, dmId } of dmThreads) {
        if (cancelled) return;
        const raw = (peer || "").trim();
        if (!raw) continue;
        const key = raw.toLowerCase();
        const cached = peerStatusRef.current[key];
        const now = Date.now();

        if (cached && now - cached.checkedAt < TTL) {
          if (cached.status === "missing") {
            clearThread(dmId);
            resetUnread(dmId);
            hideThread(dmId, now);
            await Promise.allSettled([
              removePreview(dmId),
              removeMessagesWindow(dmId),
            ]);
            if (cancelled) return;
          }
          continue;
        }

        try {
          const profile = await fetchProfileByUsername(raw);
          if (cancelled) return;
          if (!profile) {
            peerStatusRef.current[key] = {
              status: "missing",
              checkedAt: Date.now(),
            };
            clearThread(dmId);
            resetUnread(dmId);
            hideThread(dmId, Date.now());
            await Promise.allSettled([
              removePreview(dmId),
              removeMessagesWindow(dmId),
            ]);
            if (cancelled) return;
          } else {
            peerStatusRef.current[key] = {
              status: "present",
              checkedAt: Date.now(),
            };
          }
        } catch {
          peerStatusRef.current[key] = {
            status: "present",
            checkedAt: Date.now(),
          };
        }
      }
    };

    void pruneMissingPeers();

    return () => {
      cancelled = true;
    };
  }, [dmThreads, clearThread, hideThread, resetUnread]);

  const loadNextBatch = React.useCallback(() => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    Promise.resolve().then(() => {
      const end = Math.min(nextIndex + PAGE_SIZE, dmThreads.length);
      const slice = dmThreads.slice(nextIndex, end);
      if (slice.length) setVisibleThreads((prev) => [...prev, ...slice]);
      setNextIndex(end);
      setLoadingMore(false);
    });
  }, [hasMore, loadingMore, nextIndex, dmThreads]);

  useEffect(() => {
    const root = scrollRef.current;
    const el = loadMoreRef.current;
    if (!root || !el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && hasMore && !loadingMore) {
            loadNextBatch();
          }
        }
      },
      { root, threshold: OBS_THRESHOLD }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loadingMore, loadNextBatch]);

  const confirmHide = () => {
    if (!target) return;
    // WhatsApp-like: delete chat locally -> clear messages and remove card
    try {
      clearThread(target.dmId);
      resetUnread(target.dmId);
    } catch {}
    // Also mark hidden with a timestamp so it won’t flash back until a new message arrives
    hideThread(target.dmId, Date.now());
    closeSheet();
  };

  return (
    <div
      className="flex flex-col w-full relative bg-white"
      style={{ height: "calc(var(--vh, 1vh) * 100)", overflowX: "hidden" }}
      ref={containerRef}
    >
      <PageHeader
        title="Direct messages"
        position="sticky"
        heightClassName="h-12"
        containerClassName="max-w-md mx-auto"
      />

      {/* DM threads */}
      <div className="flex-1 overflow-y-auto px-4 py-4" ref={scrollRef}>
        {visibleThreads.length > 0 ? (
          <div className="space-y-2">
            {visibleThreads.map((t) => (
              <DirectMessageCard
                key={t.dmId}
                dmId={t.dmId}
                peerUsername={t.peer}
                unreadCount={t.unread}
                latestMessage={t.latestMessage}
                onClick={() => void handleOpenDM(t.peer, t.dmId)}
                onLongPress={() => handleLongPress(t.dmId)}
              />
            ))}
            {loadingMore && (
              <div className="py-2 flex justify-center">
                <LoadingSpinner size={20} label="Loading more conversations" />
              </div>
            )}
            {hasMore && <div ref={loadMoreRef} className="h-6" aria-hidden />}
          </div>
        ) : (
          <div className="text-center text-sm text-gray-500 py-16">
            No direct messages yet.
          </div>
        )}
      </div>

      {/* Delete chat BottomSheet (local delete) */}
      <BottomSheet
        isOpen={sheetOpen}
        onClose={closeSheet}
        title={undefined}
        ariaDescription="Confirm deleting this conversation from your device"
      >
        {target && (
          <div className="space-y-4 text-center" role="alert">
            <div className="flex items-center justify-center gap-2 text-sm font-semibold text-red-600">
              <Trash size={22} weight="bold" aria-hidden="true" />
              <span>Delete chat?</span>
            </div>
            <div className="text-xs text-gray-500 leading-snug">
              This deletes the chat from this device. It won’t delete messages
              for the other person.
            </div>
            <div className="flex gap-3 pt-2 justify-center">
              <button
                onClick={closeSheet}
                className="px-4 py-2 rounded-md border text-sm font-medium"
                data-autofocus
              >
                Cancel
              </button>
              <button
                onClick={confirmHide}
                className="px-4 py-2 rounded-md text-sm font-semibold bg-red-600 text-white focus:outline-none"
              >
                Delete chat
              </button>
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
};

export default DirectMessages;
