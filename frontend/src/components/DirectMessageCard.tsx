import React, { useEffect, useMemo } from "react";
import { useMessageStore } from "../stores/messageStore";
import { useAvatarStore } from "../stores/avatarStore";

const DirectMessageCard: React.FC<{
  peerUsername: string; // ensure this prop exists; if named differently, reuse that variable
  dmId?: string; // if you already have dmId in props, keep; otherwise you can omit
  avatar?: string; // optional incoming avatar prop
  lastMessage?: any; // whatever your type is; used only for fallback avatar
}> = (props) => {
  const { peerUsername, dmId, avatar: avatarProp, lastMessage } = props;

  const messagesByGroup = useMessageStore((s) => s.messages);
  const getAvatar = useAvatarStore((s) => s.getAvatar);
  const ensureAvatar = useAvatarStore((s) => s.ensure);

  useEffect(() => {
    if (peerUsername) ensureAvatar(peerUsername);
  }, [peerUsername, ensureAvatar]);

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
      (getAvatar(peerUsername) as string | null | undefined) ||
      (avatarProp as string | undefined) ||
      (lastMessage?.avatar as string | undefined) ||
      (avatarFromMessages as string | null) ||
      null
    );
  }, [
    getAvatar,
    peerUsername,
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
          width={32}
          height={32}
          decoding="async"
          fetchPriority="high"
          referrerPolicy="no-referrer"
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default DirectMessageCard;
