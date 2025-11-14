import type { Socket } from "socket.io-client";
import type { Message, MessageMedia, ReactionEmoji } from "../types";
import type { DatingProfile } from "../types";

export interface PendingMessageSnapshot {
  scopeId: string;
  scopeType: "group" | "dm";
  message: Message;
}

export interface BaseSocketSlice {
  socket: Socket | null;
  isConnected: boolean;
  pendingEdits: Set<string>;
  pendingDeletes: Set<string>;
  pendingEditSnapshots: Map<string, PendingMessageSnapshot>;
  pendingDeleteSnapshots: Map<string, PendingMessageSnapshot>;
  connect: () => void;
  ensureConnected: () => void;
  disconnect: () => void;
  hardReconnect: () => void;
}

export interface GroupSocketSlice {
  joinedGroupIds: Set<string>;
  activeGroupId: string | null;
  ensuredGroupIdsForSocket: Set<string>;
  joinGroup: (groupId: string, groupName: string) => void;
  leaveGroup: (groupId: string) => void;
  setActiveGroup: (groupId: string) => void;
  sendMessage: (
    text: string,
    replyTo: any | null,
    meta?: {
      kind?: "text" | "gif" | "media" | "audio";
      media?: MessageMedia;
      audio?: { url: string; durationMs?: number };
      localId?: string;
    }
  ) => void;
  editMessage: (originalMessage: any, newText: string) => void;
  deleteMessage: (message: any) => void;
  reactToMessage: (message: Message, emoji: ReactionEmoji) => void;
}

export interface DirectMessageSocketSlice {
  joinedDmIds: Set<string>;
  activeDmId: string | null;
  joinDM: (dmId: string, peerName: string) => void;
  leaveDM: (dmId: string) => void;
  setActiveDM: (dmId: string | null) => void;
  sendDirectMessage: (
    text: string,
    replyTo: Message | null,
    meta?: {
      kind?: "text" | "gif" | "media" | "audio";
      dmId?: string;
      media?: MessageMedia;
      audio?: { url: string; durationMs?: number };
      localId?: string;
    }
  ) => void;
  editDirectMessage: (target: Message, newText: string) => void;
  deleteDirectMessage: (target: Message) => void;
  reactToDirectMessage: (message: Message, emoji: ReactionEmoji) => void;
  notifyDmTyping: (
    dmId: string,
    typing: boolean,
    opts?: { at?: number; ttlMs?: number }
  ) => void;
}

export interface ProfileSocketSlice {
  updateBubbleColor: (color: string) => void;
  updateProfile: (username: string, avatar: string | null) => void;
}

export interface DatingSocketSlice {
  likeUser: (
    targetUsername: string,
    options?: { userId?: string | null; profile?: DatingProfile | null }
  ) => void;
  unlikeUser: (targetUsername: string) => void;
  broadcastDatingProfileUpdate: (profile: DatingProfile) => void;
}

export type SocketState = BaseSocketSlice &
  GroupSocketSlice &
  DirectMessageSocketSlice &
  ProfileSocketSlice &
  DatingSocketSlice;
