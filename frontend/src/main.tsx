import { StrictMode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { registerPWA, captureInstallPrompt } from "./pwa";
import queryClient from "./lib/queryClient";
import { initQueryPersistence } from "./lib/queryPersistence";
import { savePreview } from "./lib/previews";

// In development, aggressively clean up any previously registered service workers and caches
// to avoid stale optimized deps interfering with Vite's HMR and dynamic imports.
if (import.meta.env.DEV) {
  try {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => r.unregister()))
        .catch(() => {});
    }
    if ("caches" in window) {
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((k) => /workbox|pwa|sw|vite/i.test(k))
              .map((k) => caches.delete(k))
          )
        )
        .catch(() => {});
    }
  } catch {}
}

initQueryPersistence();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);

// Register PWA service worker and capture install prompt early
registerPWA();
captureInstallPrompt();

// Preload a few common routes on idle
if ("requestIdleCallback" in window) {
  (window as any).requestIdleCallback(async () => {
    const { preloadRoute } = await import("./utils/prefetch");
    ["/", "/direct", "/inbox"].forEach(preloadRoute);
  });
}

// Handle messages from Service Worker (e.g., previews pushed via push/sync)
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    const data: any = event.data || {};
    if (data?.type === "INBOX_PREVIEWS" && Array.isArray(data.previews)) {
      for (const p of data.previews) {
        try {
          // Expect shape: { threadId, username, text, kind, timestamp }
          if (p && p.threadId) void savePreview(p);
        } catch {}
      }
    }
  });
}
