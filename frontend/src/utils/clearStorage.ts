// Clear all app-related data from Web Storage with defensive fallbacks.
// Preference: remove known keys to avoid interfering with other apps on the same origin,
// but also provide a full clear fallback when requested.

export type ClearMode = "scoped" | "full";

// Keys used by Zustand persist or manual localStorage in this app
const SCOPED_KEYS = [
  // Zustand persisted stores
  "chat-auth",
  "chat-groups",
  "chat-messages",
  "chat-notifications",
  "user-avatars",
  "dm-hidden-threads",
  "profile-bios",
  // Likes (manual persistence)
  "funly.likes.v2",
  "inbox.lastSeenIncomingAt",
  "inbox.lastSeenOutgoingAt",
  // Misc app prefs
  "chat-bubble-color",
];

export function clearAppStorage(mode: ClearMode = "scoped") {
  try {
    if (mode === "full") {
      // Clear all site storage for this origin (local + session)
      try {
        localStorage.clear();
      } catch {}
      try {
        sessionStorage.clear();
      } catch {}
    } else {
      // Scoped: remove only keys we know we own
      for (const k of SCOPED_KEYS) {
        try {
          localStorage.removeItem(k);
        } catch {}
      }
    }
  } catch {}

  // Best-effort: clear CacheStorage (used by some PWAs); ignore errors if unsupported
  try {
    // @ts-ignore
    if (typeof caches !== "undefined" && caches?.keys) {
      // @ts-ignore
      caches.keys().then((names: string[]) => {
        names.forEach((n) => {
          try {
            // @ts-ignore
            caches.delete(n);
          } catch {}
        });
      });
    }
  } catch {}
}
