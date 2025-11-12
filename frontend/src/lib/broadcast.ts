export function broadcastMessage<T>(channel: string, payload: T): void {
  if (typeof window === "undefined" || typeof BroadcastChannel !== "function") {
    return;
  }

  try {
    const bc = new BroadcastChannel(channel);
    bc.postMessage(payload);
    bc.close();
  } catch (error) {
    console.warn("[Broadcast] failed to deliver message", error);
  }
}
