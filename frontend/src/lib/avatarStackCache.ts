// Simple session-scoped cache for group avatar stacks to survive route changes
// Stores up to 6 avatar URLs per group with a timestamp and TTL

export type AvatarStackEntry = {
  avatars: (string | null)[];
  savedAt: number; // epoch ms
};

const KEY_PREFIX = "__avatarStack:";
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function getCachedAvatars(
  groupId: string,
  ttlMs: number = DEFAULT_TTL_MS
): (string | null)[] | null {
  const store = getStore();
  if (!store) return null;
  const key = KEY_PREFIX + (groupId || "").trim();
  if (!key) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed: AvatarStackEntry = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.avatars)) return null;
    const age = Date.now() - Number(parsed.savedAt || 0);
    if (!Number.isFinite(age) || age < 0 || age > ttlMs) return null;
    return parsed.avatars.slice(0, 6);
  } catch {
    return null;
  }
}

export function setCachedAvatars(
  groupId: string,
  avatars: (string | null | undefined)[]
): void {
  const store = getStore();
  if (!store) return;
  const key = KEY_PREFIX + (groupId || "").trim();
  if (!key) return;
  try {
    const entry: AvatarStackEntry = {
      avatars: (Array.isArray(avatars) ? avatars : [])
        .map((a) => (a == null ? null : String(a)))
        .slice(0, 6),
      savedAt: Date.now(),
    };
    store.setItem(key, JSON.stringify(entry));
  } catch {}
}
