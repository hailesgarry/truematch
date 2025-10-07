import React, { useMemo } from "react";
import { usePresenceStore } from "../stores/presenceStore";
import { useAuthStore } from "../stores/authStore";
import { useMessageStore } from "../stores/messageStore";

const DirectMessageCard: React.FC<{
  peerUsername: string; // ensure this prop exists; if named differently, reuse that variable
  dmId?: string; // if you already have dmId in props, keep; otherwise you can omit
  avatar?: string; // optional incoming avatar prop
  lastMessage?: any; // whatever your type is; used only for fallback avatar
}> = (props) => {
  const { peerUsername, dmId, avatar: avatarProp, lastMessage } = props;

  const messagesByGroup = useMessageStore((s) => s.messages);

  // Prefer avatar from global stores (set at JoinPage)
  const avatarFromPresence = usePresenceStore((s: any) => {
    if (!peerUsername) return null;
    return (
      s.getAvatar?.(peerUsername) ??
      s.profiles?.[peerUsername]?.avatar ??
      s.users?.[peerUsername]?.avatar ??
      s.directory?.[peerUsername]?.avatar ??
      null
    );
  });
  const avatarFromAuth = useAuthStore((s: any) => {
    if (!peerUsername) return null;
    return (
      s.userDirectory?.[peerUsername]?.avatar ??
      s.directory?.[peerUsername]?.avatar ??
      null
    );
  });

  // Fallback: scan messages in this DM for last peer-authored avatar
  const avatarFromMessages = useMemo(() => {
    if (!dmId || !peerUsername) return null as string | null;
    const list = messagesByGroup[dmId] || [];
    const peerLc = peerUsername.toLowerCase();
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i] as any;
      if ((m?.username || "").toLowerCase() === peerLc && m?.avatar) {
        return String(m.avatar);
      }
    }
    return null as string | null;
  }, [messagesByGroup, dmId, peerUsername]);

  const finalAvatar = useMemo(() => {
    return (
      (avatarFromPresence as string | null) ||
      (avatarFromAuth as string | null) ||
      (avatarProp as string | undefined) ||
      (lastMessage?.avatar as string | undefined) ||
      (avatarFromMessages as string | null) ||
      null
    );
  }, [
    avatarFromPresence,
    avatarFromAuth,
    avatarProp,
    lastMessage?.avatar,
    avatarFromMessages,
  ]);

  return (
    <div className="relative">
      {finalAvatar ? (
        <img
          src={finalAvatar}
          alt={`${peerUsername} avatar`}
          className="w-8 h-8 rounded-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default DirectMessageCard;
