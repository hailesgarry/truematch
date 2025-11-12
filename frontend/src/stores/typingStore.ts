import { create } from "zustand";

const DEFAULT_TTL_MS = 6000;

type TypingEntry = {
  username: string;
  expiresAt: number;
};

type TypingMap = Map<string, Map<string, TypingEntry>>;

interface TypingState {
  dmTyping: TypingMap;
  setTyping: (
    dmId: string,
    username: string,
    typing: boolean,
    ttlMs?: number,
    at?: number
  ) => void;
  clearDm: (dmId: string) => void;
  isTyping: (dmId?: string | null, username?: string | null) => boolean;
  getTypingUsers: (dmId?: string | null) => string[];
}

const normalizeId = (value: string) => value.trim();
const normalizeUser = (value: string) => value.trim().toLowerCase();

export const useTypingStore = create<TypingState>()((set, get) => ({
  dmTyping: new Map<string, Map<string, TypingEntry>>(),

  setTyping: (dmId, username, typing, ttlMs = DEFAULT_TTL_MS, at) => {
    if (!dmId || !username) return;
    const scopeId = normalizeId(dmId);
    const key = normalizeUser(username);
    if (!scopeId || !key) return;

    const now = typeof at === "number" && Number.isFinite(at) ? at : Date.now();
    const expiresAt = now + Math.max(0, ttlMs);

    set((state) => {
      const next: TypingMap = new Map(state.dmTyping);
      const existing = new Map(
        next.get(scopeId) ?? new Map<string, TypingEntry>()
      );

      if (typing) {
        existing.set(key, { username, expiresAt });
      } else {
        existing.delete(key);
      }

      if (existing.size === 0) {
        next.delete(scopeId);
      } else {
        next.set(scopeId, existing);
      }

      return { dmTyping: next };
    });
  },

  clearDm: (dmId) => {
    if (!dmId) return;
    const scopeId = normalizeId(dmId);
    if (!scopeId) return;
    set((state) => {
      if (!state.dmTyping.has(scopeId)) return state;
      const next: TypingMap = new Map(state.dmTyping);
      next.delete(scopeId);
      return { dmTyping: next };
    });
  },

  isTyping: (dmId, username) => {
    if (!dmId) return false;
    const scopeId = normalizeId(dmId);
    if (!scopeId) return false;
    const state = get();
    const entry = state.dmTyping.get(scopeId);
    if (!entry) return false;

    const now = Date.now();
    let mutated = false;
    const nextEntry = new Map(entry);
    for (const [userKey, value] of entry.entries()) {
      if (!value || value.expiresAt <= now) {
        nextEntry.delete(userKey);
        mutated = true;
      }
    }

    if (mutated) {
      set((s) => {
        const updated: TypingMap = new Map(s.dmTyping);
        if (nextEntry.size === 0) {
          updated.delete(scopeId);
        } else {
          updated.set(scopeId, nextEntry);
        }
        return { dmTyping: updated };
      });
    }

    if (username) {
      const target = nextEntry.get(normalizeUser(username));
      return Boolean(target && target.expiresAt > now);
    }

    return nextEntry.size > 0;
  },

  getTypingUsers: (dmId) => {
    if (!dmId) return [];
    const scopeId = normalizeId(dmId);
    if (!scopeId) return [];
    const state = get();
    const entry = state.dmTyping.get(scopeId);
    if (!entry) return [];

    const now = Date.now();
    const alive: string[] = [];
    let mutated = false;
    const nextEntry = new Map(entry);

    for (const [userKey, value] of entry.entries()) {
      if (!value || value.expiresAt <= now) {
        nextEntry.delete(userKey);
        mutated = true;
      } else if (value.username) {
        alive.push(value.username);
      }
    }

    if (mutated) {
      set((s) => {
        const updated: TypingMap = new Map(s.dmTyping);
        if (nextEntry.size === 0) {
          updated.delete(scopeId);
        } else {
          updated.set(scopeId, nextEntry);
        }
        return { dmTyping: updated };
      });
    }

    return alive;
  },
}));
