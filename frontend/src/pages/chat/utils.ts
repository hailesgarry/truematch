import type { IdleOptions } from "./types";

export function runWhenIdle(
  cb: () => void,
  { timeout = 200, fallbackDelay = 32 }: IdleOptions = {}
): () => void {
  if (typeof window === "undefined") {
    cb();
    return () => {};
  }

  const win = window as Window & {
    requestIdleCallback?: (
      handler: IdleRequestCallback,
      opts?: { timeout?: number }
    ) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

  if (typeof win.requestIdleCallback === "function") {
    const idleHandle = win.requestIdleCallback(cb, { timeout });
    return () => {
      win.cancelIdleCallback?.(idleHandle);
    };
  }

  const timer = window.setTimeout(cb, fallbackDelay);
  return () => window.clearTimeout(timer);
}

export function rootFontSizePx(): number {
  try {
    const size = getComputedStyle(document.documentElement).fontSize;
    const n = parseFloat(size);
    return Number.isFinite(n) && n > 0 ? n : 16;
  } catch {
    return 16;
  }
}

export const normalizeUsernameKey = (value?: string | null): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export const coerceTimestampValueToMs = (value: unknown): number | null => {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.getTime();
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};
