/* eslint-disable no-restricted-globals */
/// <reference lib="webworker" />

import { clientsClaim } from "workbox-core";
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import {
  registerRoute,
  setDefaultHandler,
  setCatchHandler,
} from "workbox-routing";
import {
  NetworkFirst,
  StaleWhileRevalidate,
  CacheFirst,
  NetworkOnly,
} from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { RangeRequestsPlugin } from "workbox-range-requests";

// Ensure the TypeScript compiler treats `self` as a Service Worker global
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: any };

// Let the SW take control of clients as soon as it's activated
self.skipWaiting();
clientsClaim();

// The manifest will be injected at build time by VitePWA
precacheAndRoute(self.__WB_MANIFEST || []);
cleanupOutdatedCaches();

// App shell routing: handle navigation requests with NetworkFirst to keep it fresh
registerRoute(
  ({ request }) => request.mode === "navigate",
  new NetworkFirst({
    cacheName: "html-app-shell",
    networkTimeoutSeconds: 3,
    plugins: [],
  })
);

// Static assets: CSS/JS with StaleWhileRevalidate for fast repeat views
registerRoute(
  ({ request }) =>
    request.destination === "style" ||
    request.destination === "script" ||
    request.destination === "worker",
  new StaleWhileRevalidate({ cacheName: "static-assets" })
);

// Images: CacheFirst with 30 days max age
registerRoute(
  ({ request }) => request.destination === "image",
  new CacheFirst({
    cacheName: "images",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 60,
        maxAgeSeconds: 60 * 60 * 24 * 30,
      }),
    ],
  })
);

// Audio & video media: cache for fast replays while honoring range requests
registerRoute(
  ({ request }) =>
    request.method === "GET" &&
    (request.destination === "audio" || request.destination === "video"),
  new CacheFirst({
    cacheName: "media-av",
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new RangeRequestsPlugin(),
      new ExpirationPlugin({
        maxEntries: 60,
        maxAgeSeconds: 60 * 60 * 24 * 30,
      }),
    ],
  })
);

// API runtime requests: use NetworkOnly to avoid serving stale data and interfering
// with live updates (especially presence/online counts). If offline, requests will
// fail fast and the app can handle errors appropriately.
registerRoute(
  ({ url, request }) => {
    if (request.method !== "GET") {
      return false;
    }
    const pathname = url.pathname;
    if (pathname.startsWith("/api/groups")) {
      return true;
    }
    if (
      url.href.includes(":8080/api/groups") ||
      url.href.includes(":8081/api/groups")
    ) {
      return true;
    }
    return false;
  },
  new NetworkFirst({
    cacheName: "api-groups",
    networkTimeoutSeconds: 3,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
        headers: { "x-cacheable": "true" },
      }),
      new ExpirationPlugin({
        maxEntries: 20,
        maxAgeSeconds: 60,
      }),
    ],
  })
);

registerRoute(
  ({ url, request }) => {
    if (request.method !== "GET") {
      return false;
    }
    const pathname = url.pathname;
    if (pathname.startsWith("/api/dating")) {
      return true;
    }
    if (
      url.href.includes(":8080/api/dating") ||
      url.href.includes(":8081/api/dating")
    ) {
      return true;
    }
    return false;
  },
  new NetworkFirst({
    cacheName: "api-dating",
    networkTimeoutSeconds: 3,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
        headers: { "x-cacheable": "true" },
      }),
      new ExpirationPlugin({
        maxEntries: 20,
        maxAgeSeconds: 60,
      }),
    ],
  })
);

registerRoute(
  ({ url, request }) => {
    if (request.method !== "GET") {
      return false;
    }
    return (
      url.pathname.includes("/users/") ||
      url.href.includes(":8080/api/users") ||
      url.href.includes(":8081/api/users")
    );
  },
  new StaleWhileRevalidate({
    cacheName: "api-users",
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 60 * 5, // 5 minutes
      }),
    ],
  })
);

// Explicitly skip Socket.IO routes - they should never be cached
registerRoute(
  ({ url }) => url.pathname.includes("/socket.io/"),
  new NetworkOnly()
);

registerRoute(({ url, request }) => {
  if (request.method !== "GET") {
    return false;
  }
  return (
    url.pathname.startsWith("/api") ||
    url.href.includes(":8080/api") ||
    url.href.includes(":8081/api")
  );
}, new NetworkOnly());

// Default handler
setDefaultHandler(new StaleWhileRevalidate());

setCatchHandler(async ({ request }) => {
  if (request.mode === "navigate") {
    // You could return a fallback HTML here if desired
    return Response.error();
  }
  return Response.error();
});

// --- Push Notifications ---
self.addEventListener("push", (event: PushEvent) => {
  let data: any = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "New notification", body: event.data?.text() };
  }

  const title = data.title || "Funly";
  const options: NotificationOptions = {
    body: data.body || "",
    icon: data.icon || "/pwa-192x192.png",
    badge: data.badge || "/pwa-192x192.png",
    data: data.data || {},
    tag: data.tag,
  };

  event.waitUntil(self.registration.showNotification(title, options));

  // Optional: if payload has an inbox preview snapshot, cache it to IDB via postMessage
  try {
    if (data?.previews && Array.isArray(data.previews)) {
      event.waitUntil(
        (async () => {
          const all = await self.clients.matchAll({
            type: "window",
            includeUncontrolled: true,
          });
          for (const c of all) {
            c.postMessage({ type: "INBOX_PREVIEWS", previews: data.previews });
          }
        })()
      );
    }
  } catch {}
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const targetUrl: string = (event.notification.data as any)?.url || "/";
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const c of allClients) {
        const client = c as WindowClient;
        const url = new URL(client.url);
        if (url.pathname === new URL(targetUrl, url).pathname) {
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })()
  );
});

// Background Sync example: queue a tag to refresh inbox previews when back online
self.addEventListener("sync", (event: any) => {
  if (event.tag === "refresh-inbox-previews") {
    event.waitUntil(
      (async () => {
        // Call a compact payload endpoint if available
        try {
          // Replace with your API origin if needed
          const origin = (self.location as any).origin;
          const res = await fetch(`${origin}/api/inbox/previews`).catch(
            () => null
          );
          if (!res || !res.ok) return;
          const json = await res.json();
          const clientsList = await self.clients.matchAll({
            type: "window",
            includeUncontrolled: true,
          });
          for (const c of clientsList) {
            c.postMessage({
              type: "INBOX_PREVIEWS",
              previews: json?.previews || [],
            });
          }
        } catch {}
      })()
    );
  }
});
