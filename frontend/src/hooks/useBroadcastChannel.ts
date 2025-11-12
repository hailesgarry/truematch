import { useEffect, useRef } from "react";

export type BroadcastCallback<T> = (payload: T) => void;

/**
 * Lightweight BroadcastChannel wrapper with defensive fallbacks.
 */
export function useBroadcastChannel<T extends { type: string }>(
  name: string,
  onMessage: BroadcastCallback<T>
): void {
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof BroadcastChannel !== "function"
    ) {
      return;
    }

    const channel = new BroadcastChannel(name);
    const handleMessage = (event: MessageEvent<T>) => {
      const data = event.data;
      if (!data || typeof data.type !== "string") {
        return;
      }
      handlerRef.current(data);
    };

    channel.addEventListener("message", handleMessage);

    return () => {
      channel.removeEventListener("message", handleMessage);
      channel.close();
    };
  }, [name]);
}
