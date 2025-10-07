import { create } from "zustand";
import type { Message } from "../types";

interface ScopedComposerState {
  draft: string;
  cursorPos: number;
  replyTarget: Message | null;
}

interface ComposerState {
  // Active scope key: e.g., "group:123" or "dm:abc"
  activeScope: string | null;
  // All scoped states
  scopes: Record<string, ScopedComposerState>;
  // Mirrors of the currently active scope for convenient selection
  draft: string;
  cursorPos: number;
  replyTarget: Message | null;

  // Scope management
  setScope: (scope: string) => void;

  // Editing APIs operate on the active scope
  setDraft: (text: string, cursorPos?: number) => void;
  setCursorPos: (pos: number) => void;
  insertEmoji: (emoji: string) => void;
  insertAtCaret: (content: string) => void;
  setReplyTarget: (m: Message | null) => void;
  clearReplyTarget: () => void;
  resetDraft: () => void;

  // Focus helpers (global intent, not scoped)
  shouldFocus: boolean;
  requestFocus: () => void;
  consumeFocus: () => void;
}

export const useComposerStore = create<ComposerState>()((set, get) => ({
  activeScope: null,
  scopes: {},

  // Mirrors of active scope (default empty)
  draft: "",
  cursorPos: 0,
  replyTarget: null,

  setScope: (scope) =>
    set((s) => {
      const nextScopes = { ...s.scopes };
      const existing = nextScopes[scope] || {
        draft: "",
        cursorPos: 0,
        replyTarget: null,
      };
      nextScopes[scope] = existing;
      return {
        activeScope: scope,
        scopes: nextScopes,
        draft: existing.draft,
        cursorPos: existing.cursorPos,
        replyTarget: existing.replyTarget,
      };
    }),

  setDraft: (text, cursorPos) =>
    set((s) => {
      const scope = s.activeScope || "global";
      const prev = s.scopes[scope] || {
        draft: "",
        cursorPos: 0,
        replyTarget: null,
      };
      const nextCursor =
        typeof cursorPos === "number"
          ? Math.max(0, Math.min(cursorPos, text.length))
          : Math.min(prev.cursorPos, text.length);
      const updated: ScopedComposerState = {
        draft: text,
        cursorPos: nextCursor,
        replyTarget: prev.replyTarget,
      };
      return {
        scopes: { ...s.scopes, [scope]: updated },
        draft: updated.draft,
        cursorPos: updated.cursorPos,
        replyTarget: updated.replyTarget,
      };
    }),

  setCursorPos: (pos) =>
    set((s) => {
      const scope = s.activeScope || "global";
      const prev = s.scopes[scope] || {
        draft: "",
        cursorPos: 0,
        replyTarget: null,
      };
      const nextPos = Math.max(0, Math.min(pos, prev.draft.length));
      const updated: ScopedComposerState = {
        draft: prev.draft,
        cursorPos: nextPos,
        replyTarget: prev.replyTarget,
      };
      return {
        scopes: { ...s.scopes, [scope]: updated },
        draft: updated.draft,
        cursorPos: updated.cursorPos,
        replyTarget: updated.replyTarget,
      };
    }),

  insertEmoji: (emoji) => {
    const { draft, cursorPos } = get();
    const before = draft.slice(0, cursorPos);
    const after = draft.slice(cursorPos);
    const next = before + emoji + after;
    const newPos = before.length + emoji.length;
    // Reuse setDraft to update scoped + mirrors
    get().setDraft(next, newPos);
  },

  insertAtCaret: (content) => {
    const { draft, cursorPos } = get();
    const before = draft.slice(0, cursorPos);
    const after = draft.slice(cursorPos);
    const toInsert = content;
    const next = before + toInsert + after;
    const newPos = before.length + toInsert.length;
    get().setDraft(next, newPos);
  },

  setReplyTarget: (m) =>
    set((s) => {
      const scope = s.activeScope || "global";
      const prev = s.scopes[scope] || {
        draft: "",
        cursorPos: 0,
        replyTarget: null,
      };
      const updated: ScopedComposerState = {
        draft: prev.draft,
        cursorPos: prev.cursorPos,
        replyTarget: m,
      };
      return {
        scopes: { ...s.scopes, [scope]: updated },
        draft: updated.draft,
        cursorPos: updated.cursorPos,
        replyTarget: updated.replyTarget,
      };
    }),

  clearReplyTarget: () =>
    set((s) => {
      const scope = s.activeScope || "global";
      const prev = s.scopes[scope] || {
        draft: "",
        cursorPos: 0,
        replyTarget: null,
      };
      const updated: ScopedComposerState = {
        draft: prev.draft,
        cursorPos: prev.cursorPos,
        replyTarget: null,
      };
      return {
        scopes: { ...s.scopes, [scope]: updated },
        draft: updated.draft,
        cursorPos: updated.cursorPos,
        replyTarget: updated.replyTarget,
      };
    }),

  resetDraft: () =>
    set((s) => {
      const scope = s.activeScope || "global";
      const prev = s.scopes[scope] || {
        draft: "",
        cursorPos: 0,
        replyTarget: null,
      };
      const updated: ScopedComposerState = {
        draft: "",
        cursorPos: 0,
        replyTarget: prev.replyTarget,
      };
      return {
        scopes: { ...s.scopes, [scope]: updated },
        draft: updated.draft,
        cursorPos: updated.cursorPos,
        replyTarget: updated.replyTarget,
      };
    }),

  // Focus flow (global)
  shouldFocus: false,
  requestFocus: () => set({ shouldFocus: true }),
  consumeFocus: () => set({ shouldFocus: false }),
}));
