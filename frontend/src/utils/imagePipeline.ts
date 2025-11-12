// Lightweight utilities for progressive image UX

export function preDecodeImages(urls: string[], preloadOnly = false): void {
  if (!Array.isArray(urls) || urls.length === 0) return;
  urls.forEach((src) => {
    try {
      if (!src) return;
      if (preloadOnly) {
        const link = document.createElement("link");
        link.rel = "preload";
        link.as = "image";
        link.href = src;
        link.fetchPriority = "low" as any;
        document.head.appendChild(link);
        // Cleanup later
        setTimeout(() => link.remove(), 8000);
        return;
      }
      const img = new Image();
      img.loading = "eager";
      (img as any).decoding = "async";
      img.src = src;
      if (typeof (img as any).decode === "function") {
        (img as any)
          .decode()
          .catch(() => void 0)
          .finally(() => void 0);
      } else {
        // fallback
        img.onload = img.onerror = () => void 0;
      }
    } catch {}
  });
}

export function scheduleIdle(fn: () => void, timeout = 1200): void {
  try {
    const ric = (window as any).requestIdleCallback as
      | ((
          cb: (deadline: {
            didTimeout: boolean;
            timeRemaining: () => number;
          }) => void,
          opts?: { timeout?: number }
        ) => number)
      | undefined;
    if (ric) {
      ric(() => fn(), { timeout });
      return;
    }
  } catch {}
  // Fallback
  setTimeout(fn, timeout);
}
