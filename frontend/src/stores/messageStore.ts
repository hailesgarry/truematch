import { create } from "zustand";
import { persist } from "zustand/middleware";
import { derivePreview, savePreview } from "../lib/previews";
import { saveMessagesWindow } from "../lib/messagesCache";
import type { Message, UserReaction } from "../types";

// Align reply snapshot type with Message.replyTo structure
type ReplyRef = Message["replyTo"];

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

  pruneUserMessagesBetween: (
    groupId: string,
    username: string,
    startMs: number,
    endMs: number
  ) => void;

  setAudioDuration: (
    groupId: string,
    message: Message,
    durationMs: number
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
  reconcileSystemMessage: (
    groupId: string,
    optimisticId: string,
    real: Message
  ) => void;
}

export const useMessageStore = create<MessageState>()(
  persist(
    (set) => ({
      messages: {},
      replyTo: null,

      setMessages: (groupId, messages) =>
        set((state) => {
          const slice = messages.slice(-MAX_MESSAGES_PER_GROUP);
          // Persist preview in background (best-effort)
          try {
            const p = derivePreview(groupId, slice as any);
            if (p) void savePreview(p);
            void saveMessagesWindow(groupId, slice as any);
          } catch {}
          return {
            messages: {
              ...state.messages,
              [groupId]: slice,
            },
          };
        }),

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

          const next = [...existing, message].slice(-MAX_MESSAGES_PER_GROUP);
          // Update preview async
          try {
            const p = derivePreview(groupId, next as any);
            if (p) void savePreview(p);
            void saveMessagesWindow(groupId, next as any);
          } catch {}
          return {
            messages: {
              ...state.messages,
              [groupId]: next,
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
          if (!list.length) return state;
          const when = deletedAt || new Date().toISOString();
          const original = list.find((m) => m.messageId === messageId);
          const targetTimestamp = original?.timestamp ?? null;
          const targetUsername = original?.username ?? null;

          const matchesReply = (reply: ReplyRef | null | undefined) => {
            if (!reply) return false;
            if ((reply as any).messageId === messageId) return true;
            if (targetTimestamp && targetUsername) {
              const replyTs = (reply as any)?.timestamp ?? null;
              if (
                replyTs &&
                String(replyTs) === String(targetTimestamp) &&
                (reply as any)?.username === targetUsername
              ) {
                return true;
              }
            }
            return false;
          };

          let changed = false;
          const updated = list.map((m) => {
            let next: Message = m;

            if (m.messageId === messageId) {
              const sanitized = { ...m } as any;
              sanitized.deleted = true;
              sanitized.deletedAt = sanitized.deletedAt || when;
              sanitized.text = "";
              delete sanitized.media;
              delete sanitized.audio;
              next = sanitized as Message;
              if (next !== m) changed = true;
            }

            if (matchesReply(m.replyTo)) {
              const replySnapshot = { ...(m.replyTo as any) };
              replySnapshot.deleted = true;
              replySnapshot.deletedAt = replySnapshot.deletedAt || when;
              replySnapshot.text = "";
              if (next === m) {
                next = { ...m, replyTo: replySnapshot };
              } else {
                next = { ...next, replyTo: replySnapshot };
              }
              changed = true;
            }

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

      markDeletedLegacy: (groupId, timestamp, username, deletedAt) =>
        set((state) => {
          const list = state.messages[groupId] || [];
          if (!list.length) return state;
          const when = deletedAt || new Date().toISOString();
          const targetTs = timestamp;
          const targetUser = username;

          const matchesReply = (reply: ReplyRef | null | undefined) => {
            if (!reply) return false;
            if ((reply as any)?.timestamp && (reply as any)?.username) {
              return (
                String((reply as any).timestamp ?? "") ===
                  String(targetTs ?? "") &&
                (reply as any).username === targetUser
              );
            }
            return false;
          };

          let changed = false;
          const updated = list.map((m) => {
            let next: Message = m;

            if (m.timestamp === timestamp && m.username === username) {
              const sanitized = { ...m } as any;
              sanitized.deleted = true;
              sanitized.deletedAt = sanitized.deletedAt || when;
              sanitized.text = "";
              delete sanitized.media;
              delete sanitized.audio;
              next = sanitized as Message;
              if (next !== m) changed = true;
            }

            if (matchesReply(m.replyTo)) {
              const replySnapshot = { ...(m.replyTo as any) };
              replySnapshot.deleted = true;
              replySnapshot.deletedAt = replySnapshot.deletedAt || when;
              replySnapshot.text = "";
              if (next === m) {
                next = { ...m, replyTo: replySnapshot };
              } else {
                next = { ...next, replyTo: replySnapshot };
              }
              changed = true;
            }

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

      pruneUserMessagesBetween: (groupId, username, startMs, endMs) =>
        set((state) => {
          const safeGroup = (groupId || "").trim();
          const safeUser = (username || "").trim().toLowerCase();
          if (!safeGroup || !safeUser) return state;
          if (!Number.isFinite(startMs) || !Number.isFinite(endMs))
            return state;
          if (endMs <= startMs) return state;
          const current = state.messages[safeGroup] || [];
          if (!current.length) return state;

          const toMillis = (value: unknown): number | null => {
            if (value == null) return null;
            if (typeof value === "number" && Number.isFinite(value)) {
              return value < 1_000_000_000_000 ? value * 1000 : value;
            }
            if (value instanceof Date && Number.isFinite(value.getTime())) {
              return value.getTime();
            }
            if (typeof value === "string") {
              const numeric = Number(value);
              if (Number.isFinite(numeric)) {
                return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
              }
              const parsed = Date.parse(value);
              if (Number.isFinite(parsed)) return parsed;
            }
            return null;
          };

          const rangeStart = Math.floor(startMs);
          const rangeEnd = Math.floor(endMs);

          let changed = false;
          const filtered = current.filter((message) => {
            if (!message || typeof message !== "object") return true;
            const uname =
              typeof message.username === "string"
                ? message.username.trim().toLowerCase()
                : "";
            if (!uname || uname !== safeUser) return true;
            const candidateTimestamp =
              (message as any).timestamp ??
              (message as any).createdAt ??
              (message as any).sentAt ??
              (message as any).created_at ??
              null;
            const msValue = toMillis(candidateTimestamp);
            if (!Number.isFinite(msValue)) {
              return true;
            }
            const ms = msValue as number;
            if (ms >= rangeStart && ms < rangeEnd) {
              changed = true;
              return false;
            }
            return true;
          });

          if (!changed) return state;

          return {
            messages: {
              ...state.messages,
              [safeGroup]: filtered,
            },
          };
        }),

      setAudioDuration: (groupId, targetMessage, durationMs) =>
        set((state) => {
          const list = state.messages[groupId] || [];
          if (!list.length) return state;
          const normalized = Math.max(0, Math.round(durationMs));
          const targetId = targetMessage.messageId || null;
          const targetTimestamp = targetMessage.timestamp ?? null;
          const targetUsername = targetMessage.username;
          const targetAudio = (targetMessage as any).audio || {};

          const matchesMessage = (m: Message) =>
            targetId
              ? m.messageId === targetId
              : m.username === targetUsername &&
                ((m.timestamp ?? null) === targetTimestamp ||
                  String(m.timestamp ?? "") === String(targetTimestamp ?? ""));

          const matchesReply = (reply: Message["replyTo"] | undefined | null) =>
            targetId
              ? (reply as any)?.messageId === targetId
              : (reply as any)?.username === targetUsername &&
                (((reply as any)?.timestamp ?? null) === targetTimestamp ||
                  String((reply as any)?.timestamp ?? "") ===
                    String(targetTimestamp ?? ""));

          const mergeAudio = (existing: any) => {
            const current = existing || {};
            const incoming = targetAudio || {};
            const nextUploading =
              typeof incoming.uploading === "boolean"
                ? incoming.uploading
                : typeof current.uploading === "boolean"
                ? current.uploading
                : false;
            return {
              ...current,
              ...incoming,
              durationMs: normalized,
              uploading: nextUploading,
            };
          };

          let changed = false;
          const updated = list.map((m) => {
            let next: Message = m;

            if (matchesMessage(m)) {
              const nextAudio = mergeAudio(m.audio);
              if (
                !m.audio ||
                m.audio.durationMs !== nextAudio.durationMs ||
                m.audio.url !== nextAudio.url ||
                m.audio.uploading !== nextAudio.uploading
              ) {
                next = {
                  ...next,
                  audio: nextAudio,
                };
                changed = true;
              }
            }

            if (matchesReply(m.replyTo)) {
              const existingReply = m.replyTo || ({} as any);
              const nextReplyAudio = mergeAudio(existingReply.audio);
              if (
                !existingReply.audio ||
                existingReply.audio.durationMs !== nextReplyAudio.durationMs ||
                existingReply.audio.url !== nextReplyAudio.url ||
                existingReply.audio.uploading !== nextReplyAudio.uploading
              ) {
                next =
                  next === m
                    ? {
                        ...m,
                        replyTo: {
                          ...existingReply,
                          audio: nextReplyAudio,
                        },
                      }
                    : {
                        ...next,
                        replyTo: {
                          ...existingReply,
                          audio: nextReplyAudio,
                        },
                      };
                changed = true;
              }
            }

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
      reconcileSystemMessage: (groupId, optimisticId, real) =>
        set((state) => {
          const list = state.messages[groupId] || [];
          if (!list.length) return state;
          const idx = list.findIndex((m) => m.messageId === optimisticId);
          if (idx === -1) return state; // nothing to reconcile
          const clone = [...list];
          // Merge preserving any local edits (none expected for system messages)
          clone[idx] = { ...clone[idx], ...real, _optimistic: false } as any;
          return {
            messages: { ...state.messages, [groupId]: clone },
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
