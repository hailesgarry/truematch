import { create } from "zustand";

export type DatingLikeProfile = {
  username: string;
  userId?: string | null;
  age?: number;
  gender?: string;
  mood?: string;
  photoUrl?: string | null;
  photos?: string[];
  location?: { city?: string; state?: string; formatted?: string };
  displayName?: string | null;
  firstName?: string | null;
};

export type LikeEntry = {
  userId?: string | null;
  username: string;
  incoming?: { profile: DatingLikeProfile; at: number } | null;
  outgoing?: { at: number; profile?: DatingLikeProfile | null } | null;
};

type IncomingReplaceItem = {
  userId?: string | null;
  username?: string | null;
  displayName?: string | null;
  avatar?: string | null;
  at?: number | null;
};

type LikesState = {
  byUser: Record<string, LikeEntry>;
  lastSeenIncomingAt: number;
  lastSeenOutgoingAt: number;
  upsertIncoming: (
    user: string | { userId?: string | null; username?: string | null },
    profile: DatingLikeProfile,
    at?: number
  ) => void;
  removeIncoming: (identifier: string) => void;
  replaceIncoming: (
    items: Array<IncomingReplaceItem | { username: string; at: number }>
  ) => void;
  setOutgoing: (
    identifier: string,
    liked: boolean,
    at?: number,
    profile?: DatingLikeProfile
  ) => void;
  setLastSeenIncoming: (ts: number) => void;
  setLastSeenOutgoing: (ts: number) => void;
  clearAll: () => void;
};

const LS_KEY = "funly.likes.v2";
const LS_SEEN_INCOMING = "inbox.lastSeenIncomingAt";
const LS_SEEN_OUTGOING = "inbox.lastSeenOutgoingAt";

const normalizeIdentifier = (value?: string | null): string => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed;
};

const normalizeUsername = (value?: string | null): string => {
  const trimmed = normalizeIdentifier(value);
  return trimmed.toLowerCase();
};

const deriveKey = (
  userId?: string | null,
  username?: string | null
): string => {
  const id = normalizeIdentifier(userId);
  if (id) return `id:${id}`;
  const uname = normalizeUsername(username);
  return uname ? `name:${uname}` : "";
};

const mergePhotos = (
  existing: string[] | undefined,
  avatar?: string | null
): string[] | undefined => {
  const src = normalizeIdentifier(avatar);
  if (!src) return existing;
  const list = Array.isArray(existing) ? [...existing] : [];
  if (!list.includes(src)) list.unshift(src);
  return list.slice(0, 6);
};

const mergeProfile = (
  previous: DatingLikeProfile | undefined,
  incoming: DatingLikeProfile | undefined,
  hints: {
    username: string;
    userId?: string | null;
    displayName?: string | null;
    avatar?: string | null;
  }
): DatingLikeProfile => {
  const fallbackUsername =
    normalizeIdentifier(previous?.username) ||
    normalizeIdentifier(incoming?.username) ||
    hints.username;

  const base: DatingLikeProfile = {
    username: fallbackUsername,
    ...(previous || {}),
    ...(incoming || {}),
  };
  base.username = normalizeIdentifier(base.username) || hints.username;
  if (hints.userId) base.userId = hints.userId;
  if (typeof hints.displayName === "string") {
    const display = hints.displayName.trim();
    if (display) {
      base.displayName = display;
      if (!base.firstName) base.firstName = display;
    }
  }
  if (hints.avatar) {
    base.photoUrl = hints.avatar;
    base.photos = mergePhotos(base.photos, hints.avatar);
  } else if (!base.photos && base.photoUrl) {
    base.photos = [base.photoUrl];
  }
  return base;
};

const normalizeStoredMap = (
  raw: Record<string, LikeEntry> | null | undefined
): Record<string, LikeEntry> => {
  if (!raw || typeof raw !== "object") return {};
  const next: Record<string, LikeEntry> = {};
  for (const value of Object.values(raw)) {
    if (!value) continue;
    const userId = normalizeIdentifier(value.userId);
    const username = normalizeIdentifier(
      value.username || value.incoming?.profile?.username
    );
    const key = deriveKey(userId, username);
    if (!key) continue;
    next[key] = {
      ...value,
      userId: userId || value.userId || null,
      username: username || value.username || "",
    };
  }
  return next;
};

function loadFromStorage(): Record<string, LikeEntry> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return normalizeStoredMap(parsed);
  } catch {}
  return {};
}

function saveToStorage(byUser: Record<string, LikeEntry>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(byUser));
  } catch {}
}

const loadSeen = (key: string): number => {
  const v = Number(localStorage.getItem(key) || "0");
  return Number.isFinite(v) ? v : 0;
};

const saveSeen = (key: string, ts: number) => {
  try {
    localStorage.setItem(key, String(ts));
  } catch {}
};

const normalizeIncomingItem = (
  item: IncomingReplaceItem | { username: string; at: number }
): {
  key: string;
  userId?: string | null;
  username: string;
  at: number;
  displayName?: string | null;
  avatar?: string | null;
} | null => {
  if (!item || typeof item !== "object") return null;
  const rawUsername =
    "username" in item && typeof item.username === "string"
      ? item.username.trim()
      : typeof (item as any).from === "string"
      ? (item as any).from.trim()
      : "";
  const rawUserId =
    "userId" in item && typeof item.userId === "string"
      ? item.userId.trim()
      : "";
  const key = deriveKey(rawUserId, rawUsername);
  if (!key) return null;
  const atValue = Number(
    ("at" in item ? item.at : undefined) ?? (item as any).likedAt ?? 0
  );
  const displayName =
    "displayName" in item && typeof item.displayName === "string"
      ? item.displayName
      : typeof (item as any).name === "string"
      ? (item as any).name
      : undefined;
  const avatar =
    "avatar" in item && typeof item.avatar === "string"
      ? item.avatar
      : undefined;
  return {
    key,
    userId: rawUserId || null,
    username: rawUsername || rawUserId || "",
    at: Number.isFinite(atValue) && atValue > 0 ? atValue : Date.now(),
    displayName: displayName ?? null,
    avatar: avatar ?? null,
  };
};

export const useLikesStore = create<LikesState>()((set) => ({
  byUser: loadFromStorage(),
  lastSeenIncomingAt: loadSeen(LS_SEEN_INCOMING),
  lastSeenOutgoingAt: loadSeen(LS_SEEN_OUTGOING),

  upsertIncoming: (user, profile, at) => {
    const identifiers =
      typeof user === "string"
        ? { userId: profile?.userId ?? null, username: user }
        : {
            userId: user?.userId ?? profile?.userId ?? null,
            username: user?.username ?? profile?.username ?? "",
          };
    const username = normalizeIdentifier(
      profile?.username ?? identifiers.username
    );
    if (!username) return;
    const key = deriveKey(identifiers.userId, username);
    if (!key) return;
    const timestamp = Number(at) || Date.now();

    set((state) => {
      const prev = state.byUser[key];
      const mergedProfile = mergeProfile(
        prev?.incoming?.profile ?? undefined,
        profile,
        {
          username,
          userId: identifiers.userId,
          displayName: profile?.displayName ?? profile?.firstName ?? null,
          avatar:
            profile?.photoUrl ||
            (Array.isArray(profile?.photos) ? profile.photos[0] : null),
        }
      );
      const nextEntry: LikeEntry = {
        userId: identifiers.userId || prev?.userId || profile?.userId || null,
        username: mergedProfile.username || prev?.username || username,
        incoming: { profile: mergedProfile, at: timestamp },
        outgoing: prev?.outgoing || null,
      };
      const next = { ...state.byUser, [key]: nextEntry };
      saveToStorage(next);
      return { byUser: next };
    });
  },

  removeIncoming: (identifier) => {
    const value = normalizeIdentifier(identifier);
    if (!value) return;
    const candidateKeys = [
      deriveKey(value, null),
      deriveKey(null, value),
    ].filter(Boolean) as string[];
    if (!candidateKeys.length) return;

    set((state) => {
      const map = { ...state.byUser };
      let mutated = false;
      for (const key of candidateKeys) {
        const prev = map[key];
        if (!prev) continue;
        const nextEntry: LikeEntry = {
          userId: prev.userId,
          username: prev.username,
          incoming: null,
          outgoing: prev.outgoing || null,
        };
        if (!nextEntry.outgoing) {
          delete map[key];
        } else {
          map[key] = nextEntry;
        }
        mutated = true;
      }
      if (!mutated) return state;
      saveToStorage(map);
      return { byUser: map };
    });
  },

  replaceIncoming: (items) => {
    const normalized = Array.isArray(items)
      ? items
          .map((item) => normalizeIncomingItem(item))
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
      : [];

    set((state) => {
      const map = { ...state.byUser };
      const seen = new Set<string>();
      let mutated = false;

      for (const entry of normalized) {
        const prev = map[entry.key];
        const mergedProfile = mergeProfile(
          prev?.incoming?.profile ?? undefined,
          undefined,
          {
            username: entry.username,
            userId: entry.userId ?? prev?.userId ?? null,
            displayName: entry.displayName ?? null,
            avatar: entry.avatar ?? null,
          }
        );
        const nextEntry: LikeEntry = {
          userId: entry.userId ?? prev?.userId ?? null,
          username: mergedProfile.username || prev?.username || entry.username,
          incoming: { profile: mergedProfile, at: entry.at },
          outgoing: prev?.outgoing || null,
        };
        map[entry.key] = nextEntry;
        seen.add(entry.key);
        if (
          !prev ||
          prev.userId !== nextEntry.userId ||
          prev.username !== nextEntry.username ||
          (prev.incoming?.at || 0) !== entry.at ||
          JSON.stringify(prev.incoming?.profile) !==
            JSON.stringify(nextEntry.incoming?.profile)
        ) {
          mutated = true;
        }
      }

      for (const [key, value] of Object.entries(map)) {
        if (!value?.incoming) continue;
        if (seen.has(key)) continue;
        const nextEntry: LikeEntry = {
          userId: value.userId,
          username: value.username,
          incoming: null,
          outgoing: value.outgoing || null,
        };
        if (!nextEntry.outgoing) {
          delete map[key];
        } else {
          map[key] = nextEntry;
        }
        mutated = true;
      }

      if (!mutated) return state;
      saveToStorage(map);
      return { byUser: map };
    });
  },

  setOutgoing: (identifier, liked, at, profile) => {
    const username = normalizeIdentifier(identifier);
    if (!username) return;
    const keyByName = deriveKey(null, username);

    set((state) => {
      let key = keyByName;
      let prev = state.byUser[key];
      if (!prev) {
        for (const [candidateKey, value] of Object.entries(state.byUser)) {
          if (value.username.toLowerCase() === username.toLowerCase()) {
            key = candidateKey;
            prev = value;
            break;
          }
        }
      }

      const mergedProfile = mergeProfile(
        prev?.outgoing?.profile ?? undefined,
        profile,
        {
          username,
          userId: profile?.userId ?? prev?.userId ?? null,
          displayName: profile?.displayName ?? profile?.firstName ?? null,
          avatar:
            profile?.photoUrl ||
            (Array.isArray(profile?.photos) ? profile.photos[0] : null),
        }
      );

      const nextEntry: LikeEntry = {
        userId: profile?.userId ?? prev?.userId ?? null,
        username: prev?.username || username,
        incoming: prev?.incoming || null,
        outgoing: liked
          ? { at: at || Date.now(), profile: mergedProfile }
          : null,
      };

      const map = { ...state.byUser };
      if (!nextEntry.incoming && !nextEntry.outgoing) {
        delete map[key];
      } else {
        map[key] = nextEntry;
      }
      saveToStorage(map);
      return { byUser: map };
    });
  },

  setLastSeenIncoming: (ts) => {
    const atValue = Number.isFinite(ts) ? ts : Date.now();
    saveSeen(LS_SEEN_INCOMING, atValue);
    set({ lastSeenIncomingAt: atValue });
  },

  setLastSeenOutgoing: (ts) => {
    const atValue = Number.isFinite(ts) ? ts : Date.now();
    saveSeen(LS_SEEN_OUTGOING, atValue);
    set({ lastSeenOutgoingAt: atValue });
  },

  clearAll: () => {
    saveToStorage({});
    set({ byUser: {} });
  },
}));
