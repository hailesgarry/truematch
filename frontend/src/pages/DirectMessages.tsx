import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { useSocketStore } from "../stores/socketStore";
import { useNotificationStore } from "../stores/notificationStore";
import { useMessageStore } from "../stores/messageStore";
import DirectMessageCard from "../components/common/DirectMessageCard";
import { peerFromDmId } from "../utils/direct";
import { useAvatarStore } from "../stores/avatarStore";
import BottomSheet from "../components/common/BottomSheet";
import { useUiStore } from "../stores/uiStore";
import type { Message } from "../types";
import { useDmThreadStore } from "../stores/dmThreadStore";
import { Trash } from "phosphor-react";

const DirectMessages: React.FC = () => {
  const navigate = useNavigate();
  const { joined, username } = useAuthStore();
  const { ensureConnected } = useSocketStore();
  const unreadByGroup = useNotificationStore((s) => s.unreadByGroup);
  const allMessages = useMessageStore((s) => s.messages);
  const containerRef = useRef<HTMLDivElement>(null);
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

  const dmThreads = useMemo(() => {
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
    const result: {
      dmId: string;
      peer: string;
      latestTs: number;
      unread: number;
    }[] = [];

    for (const key of Object.keys(allMessages)) {
      if (!key.startsWith("dm:")) continue;
      // Skip hidden threads unless there are new messages newer than hiddenAt
      const hiddenAt = getHiddenAt(key) ?? undefined;
      const list = allMessages[key] || [];
      if (!list.length) continue;

      // latest non-system, non-deleted from the end (for preview)
      let latest = list[list.length - 1];
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i] as any;
        if (!m?.system && !m?.deleted) {
          latest = list[i];
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

  const handleOpenDM = (peer: string, dmId: string) => {
    try {
      useNotificationStore.getState().reset(dmId);
    } catch {}
    navigate(`/dm/${encodeURIComponent(peer)}`, {
      state: { from: "/direct" },
    });
  };

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
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-white">
        <div className="max-w-md mx-auto h-14 px-4 border-gray-100">
          <div className="flex items-center h-full">
            <span className="text-base font-semibold text-gray-900">
              Direct messages
            </span>
          </div>
        </div>
      </div>

      {/* DM threads */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {dmThreads.length > 0 ? (
          <div className="space-y-2">
            {dmThreads.map((t) => (
              <DirectMessageCard
                key={t.dmId}
                dmId={t.dmId}
                peerUsername={t.peer}
                unreadCount={t.unread}
                onClick={() => handleOpenDM(t.peer, t.dmId)}
                onLongPress={() => handleLongPress(t.dmId)}
              />
            ))}
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
