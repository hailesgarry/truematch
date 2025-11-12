import type { Message } from "../types";
import { idbGet, idbRemove, idbSet, STORES } from "./idb";

const MAX_PER_THREAD = 30;

export async function saveMessagesWindow(threadId: string, list: Message[]) {
  try {
    const tail = list.slice(-MAX_PER_THREAD);
    await idbSet(STORES.MESSAGES, threadId, tail);
  } catch {}
}

export async function getMessagesWindow(
  threadId: string
): Promise<Message[] | undefined> {
  try {
    return (await idbGet<Message[]>(STORES.MESSAGES, threadId)) || undefined;
  } catch {
    return undefined;
  }
}

export async function removeMessagesWindow(threadId: string): Promise<void> {
  try {
    await idbRemove(STORES.MESSAGES, threadId);
  } catch {}
}
