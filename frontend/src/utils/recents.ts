// LocalStorage keys & limits
const EMOJI_KEY = "recent_emojis_v1";
const GIF_KEY = "recent_gifs_v1";
const MAX_EMOJIS = 24;
const MAX_GIFS = 20;

function pushUnique<T>(
  list: T[],
  item: T,
  match: (a: T, b: T) => boolean,
  max: number
): T[] {
  const idx = list.findIndex((x) => match(x, item));
  if (idx !== -1) list.splice(idx, 1);
  list.unshift(item);
  return list.slice(0, max);
}

/* Emojis */
export function loadRecentEmojis(): string[] {
  try {
    const raw = localStorage.getItem(EMOJI_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as string[]) : [];
  } catch {
    return [];
  }
}

export function addRecentEmoji(emoji: string) {
  try {
    const list = loadRecentEmojis();
    const next = pushUnique(list, emoji, (a, b) => a === b, MAX_EMOJIS);
    localStorage.setItem(EMOJI_KEY, JSON.stringify(next));
  } catch {}
}

export function clearRecentEmojis() {
  localStorage.removeItem(EMOJI_KEY);
}

/* GIFs */
export interface RecentGif {
  id: string;
  preview: string;
  gif?: string;
  mp4?: string;
  webm?: string;
  original: string;
}

export function loadRecentGifs(): RecentGif[] {
  try {
    const raw = localStorage.getItem(GIF_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (g) => g && g.id && (g.preview || g.gif || g.original)
    ) as RecentGif[];
  } catch {
    return [];
  }
}

export function addRecentGif(data: RecentGif) {
  try {
    const list = loadRecentGifs();
    const next = pushUnique(list, data, (a, b) => a.id === b.id, MAX_GIFS);
    localStorage.setItem(GIF_KEY, JSON.stringify(next));
  } catch {}
}

export function clearRecentGifs() {
  localStorage.removeItem(GIF_KEY);
}
