import type { Message } from "../types";
import { idbGet, idbGetAll, idbRemove, idbSet, STORES } from "./idb";

export type ThreadId = string; // groupId or dm:<peer>

export type Preview = {
  threadId: ThreadId;
  username?: string;
  text?: string;
  kind?: string; // gif | media | text | system
  timestamp?: string;
};

export async function savePreview(p: Preview): Promise<void> {
  return idbSet(STORES.PREVIEWS, p.threadId, p);
}

export async function getPreview(
  threadId: ThreadId
): Promise<Preview | undefined> {
  return idbGet(STORES.PREVIEWS, threadId);
}

export async function getAllPreviews(): Promise<Preview[]> {
  const items = await idbGetAll<Preview>(STORES.PREVIEWS);
  return items.map((i) => i.value);
}

export async function removePreview(threadId: ThreadId): Promise<void> {
  return idbRemove(STORES.PREVIEWS, threadId);
}

// Derive a preview from a messages array (latest non-system, non-deleted)
export function derivePreview(
  threadId: ThreadId,
  list: Message[]
): Preview | undefined {
  if (!Array.isArray(list) || !list.length) return undefined;
  let latest = list[list.length - 1] as any;
  for (let i = list.length - 1; i >= 0; i--) {
    const m: any = list[i];
    if (!m?.system && !m?.deleted) {
      latest = list[i];
      break;
    }
  }
  const kind =
    (latest as any).kind ||
    (() => {
      const text = String((latest as any)?.text || "").trim();
      if (!text) return "text";
      if (!text.includes(" ") && /\.gif(\?|#|$)/i.test(text)) return "gif";
      return "text";
    })();
  return {
    threadId,
    username: (latest as any)?.username,
    text: (latest as any)?.text,
    kind,
    timestamp: (latest as any)?.timestamp,
  };
}
