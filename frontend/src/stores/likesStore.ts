import { create } from "zustand";

export type DatingLikeProfile = {
  username: string;
  age?: number;
  gender?: string;
  mood?: string;
  photoUrl?: string | null;
  photos?: string[]; // optional multi-photo support
  location?: { city?: string; state?: string; formatted?: string };
  displayName?: string | null;
  firstName?: string | null;
};

export type LikeEntry = {
  username: string;
  // They liked me (Inbox Likes)
  incoming?: { profile: DatingLikeProfile; at: number } | null;
  // I liked them (controls heart + My Likes)
  outgoing?: { at: number; profile?: DatingLikeProfile | null } | null; // UPDATED
};

type LikesState = {
  byUser: Record<string, LikeEntry>;

  // NEW: cross-app last-seen timestamps for badges (persisted)
  lastSeenIncomingAt: number;
  lastSeenOutgoingAt: number;

  upsertIncoming: (
    username: string,
    profile: DatingLikeProfile,
    at?: number
  ) => void;
  removeIncoming: (username: string) => void;
  setOutgoing: (
    username: string,
    liked: boolean,
    at?: number,
    profile?: DatingLikeProfile
  ) => void; // UPDATED
  setOutgoingProfile: (username: string, profile: DatingLikeProfile) => void; // NEW

  // NEW: setters for last-seen
  setLastSeenIncoming: (ts: number) => void;
  setLastSeenOutgoing: (ts: number) => void;

  clearAll: () => void;
};

const LS_KEY = "funly.likes.v2"; // map of byUser
const LS_SEEN_INCOMING = "inbox.lastSeenIncomingAt";
const LS_SEEN_OUTGOING = "inbox.lastSeenOutgoingAt";

function loadFromStorage(): Record<string, LikeEntry> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}
  return {};
}

function saveToStorage(byUser: Record<string, LikeEntry>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(byUser));
  } catch {}
}

function loadSeen(key: string): number {
  const v = Number(localStorage.getItem(key) || "0");
  return Number.isFinite(v) ? v : 0;
}

function saveSeen(key: string, ts: number) {
  try {
    localStorage.setItem(key, String(ts));
  } catch {}
}

export const useLikesStore = create<LikesState>()((set) => ({
  byUser: loadFromStorage(),

  // NEW: init from localStorage
  lastSeenIncomingAt: loadSeen(LS_SEEN_INCOMING),
  lastSeenOutgoingAt: loadSeen(LS_SEEN_OUTGOING),

  upsertIncoming: (username, profile, at) => {
    const key = (username || profile?.username || "").toLowerCase();
    if (!key) return;
    set((state) => {
      const prev = state.byUser[key] || {
        username: profile.username || username,
      };
      const nextEntry: LikeEntry = {
        username: profile.username || username,
        incoming: {
          profile: { ...profile, username: profile.username || username },
          at: at || Date.now(),
        },
        outgoing: prev.outgoing || null,
      };
      const next = { ...state.byUser, [key]: nextEntry };
      saveToStorage(next);
      return { byUser: next };
    });
  },

  removeIncoming: (username) => {
    const key = String(username || "").toLowerCase();
    set((state) => {
      const prev = state.byUser[key];
      if (!prev) return state;
      const updated: LikeEntry = {
        username: prev.username,
        incoming: null,
        outgoing: prev.outgoing || null,
      };
      const next = { ...state.byUser };
      if (!updated.incoming && !updated.outgoing) delete next[key];
      else next[key] = updated;
      saveToStorage(next);
      return { byUser: next };
    });
  },

  setOutgoing: (username, liked, at, profile) => {
    const key = String(username || "").toLowerCase();
    if (!key) return;
    set((state) => {
      const prev = state.byUser[key] || { username };
      const next: LikeEntry = {
        username: prev.username || username,
        incoming: prev.incoming || null,
        outgoing: liked
          ? {
              at: at || Date.now(),
              profile: profile || prev.outgoing?.profile || null,
            }
          : null,
      };
      const map = { ...state.byUser };
      if (!next.incoming && !next.outgoing) delete map[key];
      else map[key] = next;
      saveToStorage(map);
      return { byUser: map };
    });
  },

  setOutgoingProfile: (username, profile) => {
    const key = String(username || "").toLowerCase();
    if (!key) return;
    set((state) => {
      const prev = state.byUser[key];
      if (!prev || !prev.outgoing) {
        const next: LikeEntry = {
          username: profile.username || username,
          incoming: prev?.incoming || null,
          outgoing: {
            at: Date.now(),
            profile: { ...profile, username: profile.username || username },
          },
        };
        const map = { ...state.byUser, [key]: next };
        saveToStorage(map);
        return { byUser: map };
      }
      const next: LikeEntry = {
        ...prev,
        outgoing: {
          at: prev.outgoing.at,
          profile: { ...profile, username: profile.username || username },
        },
      };
      const map = { ...state.byUser, [key]: next };
      saveToStorage(map);
      return { byUser: map };
    });
  },

  // NEW: last-seen setters
  setLastSeenIncoming: (ts) => {
    const at = Number.isFinite(ts) ? ts : Date.now();
    saveSeen(LS_SEEN_INCOMING, at);
    set({ lastSeenIncomingAt: at });
  },
  setLastSeenOutgoing: (ts) => {
    const at = Number.isFinite(ts) ? ts : Date.now();
    saveSeen(LS_SEEN_OUTGOING, at);
    set({ lastSeenOutgoingAt: at });
  },

  clearAll: () => {
    saveToStorage({});
    // Keep last-seen values; user preference
    set({ byUser: {} });
  },
}));
