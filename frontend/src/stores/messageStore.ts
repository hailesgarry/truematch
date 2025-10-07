import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Message, UserReaction } from "../types";

// Extend replyTo shape locally (optional)
interface ReplyRef {
  messageId?: string;
  username: string;
  text: string;
  timestamp?: string | null;
}

const MAX_MESSAGES_PER_GROUP = 300;

interface MessageState {
  messages: Record<string, Message[]>;
  replyTo: ReplyRef | null;
  setMessages: (groupId: string, messages: Message[]) => void;
  clearThread: (groupId: string) => void;
  clearAll: () => void;
  addMessage: (groupId: string, message: Message) => void;
  editMessage: (
    groupId: string,
    messageTimestamp: string,
    username: string,
    newText: string
  ) => void;
  deleteMessage: (
    groupId: string,
    messageTimestamp: string,
    username: string
  ) => void;

  // NEW canonical id variants
  editMessageById: (
    groupId: string,
    messageId: string,
    newText: string
  ) => void;
  deleteMessageById: (groupId: string, messageId: string) => void;

  markDeletedById: (
    groupId: string,
    messageId: string,
    deletedAt?: string
  ) => void;
  markDeletedLegacy: (
    groupId: string,
    timestamp: string,
    username: string,
    deletedAt?: string
  ) => void;

  setReplyTo: (reply: ReplyRef | null) => void;
  updateBubbleColorForUser: (
    groupId: string,
    username: string,
    bubbleColor: string
  ) => void;
  updateUserProfileForUser: (
    groupId: string,
    userId: string | null,
    newUsername?: string,
    newAvatar?: string | null
  ) => void;
  updateMessageReactionsById: (
    groupId: string,
    messageId: string,
    reactions: Record<string, UserReaction>
  ) => void;
  // Fallback for legacy messages without messageId
  updateMessageReactionsLegacy: (
    groupId: string,
    timestamp: string,
    username: string,
    reactions: Record<string, UserReaction>
  ) => void;
}

export const useMessageStore = create<MessageState>()(
  persist(
    (set) => ({
      messages: {},
      replyTo: null,

      setMessages: (groupId, messages) =>
        set((state) => ({
          messages: {
            ...state.messages,
            [groupId]: messages.slice(-MAX_MESSAGES_PER_GROUP),
          },
        })),

      clearThread: (groupId) =>
        set((state) => {
          if (!(groupId in state.messages)) return state;
          const next = { ...state.messages } as Record<string, Message[]>;
          delete next[groupId];
          return { messages: next } as any;
        }),

      clearAll: () => set({ messages: {}, replyTo: null }),

      addMessage: (groupId, message) =>
        set((state) => {
          const existing = state.messages[groupId] || [];

          // If messageId present, prevent duplicates (idempotent add)
          if (message.messageId) {
            const idx = existing.findIndex(
              (m) => m.messageId === message.messageId
            );
            if (idx !== -1) {
              // Merge (avoid clobbering newer text edits)
              const merged = { ...existing[idx], ...message };
              const clone = [...existing];
              clone[idx] = merged;
              return {
                messages: {
                  ...state.messages,
                  [groupId]: clone.slice(-MAX_MESSAGES_PER_GROUP),
                },
              };
            }
          }

          return {
            messages: {
              ...state.messages,
              [groupId]: [...existing, message].slice(-MAX_MESSAGES_PER_GROUP),
            },
          };
        }),

      editMessage: (groupId, messageTimestamp, username, newText) =>
        set((state) => {
          const groupMessages = state.messages[groupId] || [];
          return {
            messages: {
              ...state.messages,
              [groupId]: groupMessages.map((m) =>
                m.timestamp === messageTimestamp && m.username === username
                  ? { ...m, text: newText }
                  : m
              ),
            },
          };
        }),

      deleteMessage: (groupId, messageTimestamp, username) =>
        set((state) => {
          const groupMessages = state.messages[groupId] || [];
          return {
            messages: {
              ...state.messages,
              [groupId]: groupMessages.filter(
                (m) =>
                  !(m.timestamp === messageTimestamp && m.username === username)
              ),
            },
          };
        }),

      editMessageById: (groupId, messageId, newText) =>
        set((state) => {
          const groupMessages = state.messages[groupId] || [];
          const now = new Date().toISOString();
          return {
            messages: {
              ...state.messages,
              [groupId]: groupMessages.map((m) =>
                m.messageId === messageId
                  ? {
                      ...m,
                      text: newText,
                      edited: true,
                      lastEditedAt: now, // optimistic; server will reconcile
                    }
                  : m
              ),
            },
          };
        }),

      deleteMessageById: (groupId, messageId) =>
        set((state) => {
          const groupMessages = state.messages[groupId] || [];
          return {
            messages: {
              ...state.messages,
              [groupId]: groupMessages.filter((m) => m.messageId !== messageId),
            },
          };
        }),

      markDeletedById: (groupId, messageId, deletedAt) =>
        set((state) => {
          const list = state.messages[groupId] || [];
          return {
            messages: {
              ...state.messages,
              [groupId]: list.map((m) =>
                m.messageId === messageId
                  ? {
                      ...m,
                      deleted: true,
                      deletedAt:
                        deletedAt || m.deletedAt || new Date().toISOString(),
                      text: "",
                    }
                  : m
              ),
            },
          };
        }),

      markDeletedLegacy: (groupId, timestamp, username, deletedAt) =>
        set((state) => {
          const list = state.messages[groupId] || [];
          return {
            messages: {
              ...state.messages,
              [groupId]: list.map((m) =>
                m.timestamp === timestamp && m.username === username
                  ? {
                      ...m,
                      deleted: true,
                      deletedAt: deletedAt || new Date().toISOString(),
                      text: "",
                    }
                  : m
              ),
            },
          };
        }),

      setReplyTo: (reply) => set({ replyTo: reply }),
      updateBubbleColorForUser: (groupId, username, bubbleColor) =>
        set((state) => {
          const groupMessages = state.messages[groupId] || [];
          const changed = groupMessages.some(
            (m) => m.username === username && m.bubbleColor !== bubbleColor
          );
          if (!changed) return state;
          return {
            messages: {
              ...state.messages,
              [groupId]: groupMessages.map((m) =>
                m.username === username ? { ...m, bubbleColor } : m
              ),
            },
          };
        }),
      updateUserProfileForUser: (
        groupId: string,
        userId: string | null,
        newUsername?: string,
        newAvatar?: string | null
      ) =>
        set((state) => {
          const groupMessages = state.messages[groupId] || [];
          let changed = false;
          const updated = groupMessages.map((m) => {
            const match =
              (userId && m.userId === userId) ||
              (!userId && newUsername && m.username === newUsername);
            if (!match) return m;
            let next = m;
            if (newUsername && m.username !== newUsername) {
              next = { ...next, username: newUsername };
            }
            if (newAvatar !== undefined && m.avatar !== newAvatar) {
              if (next === m) next = { ...next };
              next.avatar = newAvatar;
            }
            if (next !== m) changed = true;
            return next;
          });
          if (!changed) return state;
          return {
            messages: {
              ...state.messages,
              [groupId]: updated,
            },
          };
        }),
      updateMessageReactionsById: (groupId, messageId, reactions) =>
        set((state) => {
          const list = state.messages[groupId] || [];
          if (!list.length) return state;
          const updated = list.map((m) =>
            m.messageId === messageId ? { ...m, reactions: reactions || {} } : m
          );
          return {
            messages: {
              ...state.messages,
              [groupId]: updated,
            },
          };
        }),

      updateMessageReactionsLegacy: (groupId, timestamp, username, reactions) =>
        set((state) => {
          const list = state.messages[groupId] || [];
          if (!list.length) return state;
          const updated = list.map((m) =>
            m.timestamp === timestamp && m.username === username
              ? { ...m, reactions: reactions || {} }
              : m
          );
          return {
            messages: {
              ...state.messages,
              [groupId]: updated,
            },
          };
        }),
    }),
    {
      name: "chat-messages",
      partialize: (s) => ({ messages: s.messages }),
      version: 1,
    }
  )
);
