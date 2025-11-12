import { useEffect, useState } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { Message } from "../types";

const MEDIA_BLOB_STALE_TIME = 1000 * 60 * 5; // 5 minutes
const MEDIA_BLOB_CACHE_TIME = 1000 * 60 * 60 * 6; // 6 hours
const MEDIA_OBJECT_URL_IDLE_TTL = 1000 * 60 * 5; // 5 minutes
const MEDIA_BLOB_MAX_ENTRIES = 150;
const MEDIA_CACHE_NAME = "media-blobs";

type ObjectUrlEntry = {
  blob: Blob;
  objectUrl: string;
  refCount: number;
  revokeTimer: ReturnType<typeof setTimeout> | null;
};

const objectUrlCache = new Map<string, ObjectUrlEntry>();

function retainObjectUrl(sourceUrl: string, blob: Blob): string | null {
  if (typeof window === "undefined" || typeof URL === "undefined") {
    return null;
  }

  let entry = objectUrlCache.get(sourceUrl);

  if (entry && entry.blob !== blob) {
    if (entry.revokeTimer) {
      clearTimeout(entry.revokeTimer);
      entry.revokeTimer = null;
    }
    try {
      URL.revokeObjectURL(entry.objectUrl);
    } catch {}
    objectUrlCache.delete(sourceUrl);
    entry = undefined;
  }

  if (!entry) {
    const objectUrl = URL.createObjectURL(blob);
    entry = {
      blob,
      objectUrl,
      refCount: 0,
      revokeTimer: null,
    };
    objectUrlCache.set(sourceUrl, entry);
  }

  entry.refCount += 1;
  if (entry.revokeTimer) {
    clearTimeout(entry.revokeTimer);
    entry.revokeTimer = null;
  }

  return entry.objectUrl;
}

function releaseObjectUrl(sourceUrl: string) {
  const entry = objectUrlCache.get(sourceUrl);
  if (!entry) return;

  entry.refCount = Math.max(0, entry.refCount - 1);
  if (entry.refCount > 0) return;

  if (entry.revokeTimer) return;

  entry.revokeTimer = setTimeout(() => {
    const current = objectUrlCache.get(sourceUrl);
    if (!current || current.refCount > 0) {
      if (current) {
        current.revokeTimer = null;
      }
      return;
    }

    try {
      URL.revokeObjectURL(current.objectUrl);
    } catch {}
    objectUrlCache.delete(sourceUrl);
  }, MEDIA_OBJECT_URL_IDLE_TTL);
}

export const mediaBlobKey = (url: string) => ["media-blob", url] as const;

async function fetchMediaBlob(
  url: string,
  signal?: AbortSignal
): Promise<Blob> {
  const shouldIncludeCredentials = (() => {
    if (typeof window === "undefined") return true;
    try {
      const target = new URL(url, window.location.href);
      return target.origin === window.location.origin;
    } catch {
      return false;
    }
  })();

  const res = await fetch(url, {
    credentials: shouldIncludeCredentials ? "include" : "omit",
    signal,
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch media: ${res.status}`);
  }
  return await res.blob();
}

export const prefetchMediaBlob = async (
  client: QueryClient,
  url: string
): Promise<void> => {
  const trimmed = url.trim();
  if (!trimmed) return;

  await client.prefetchQuery({
    queryKey: mediaBlobKey(trimmed),
    queryFn: ({ signal }) => fetchMediaBlob(trimmed, signal),
    staleTime: MEDIA_BLOB_STALE_TIME,
    gcTime: MEDIA_BLOB_CACHE_TIME,
  });

  if (typeof window !== "undefined" && "caches" in window) {
    try {
      const cache = await caches.open(MEDIA_CACHE_NAME);
      const match = await cache.match(trimmed);
      if (!match) {
        const response = await fetch(trimmed, { cache: "reload" });
        if (response.ok) {
          await cache.put(trimmed, response.clone());
        }
      }
    } catch {
      /* swallow */
    }
  }
};

async function enforceCacheLimit(maxEntries: number) {
  if (typeof window === "undefined" || !("caches" in window)) return;
  try {
    const cache = await caches.open(MEDIA_CACHE_NAME);
    const requests = await cache.keys();
    if (requests.length <= maxEntries) return;
    const removeCount = requests.length - maxEntries;
    for (let i = 0; i < removeCount; i += 1) {
      const req = requests[i];
      await cache.delete(req);
    }
  } catch {
    /* ignore */
  }
}

export function useCachedMediaBlob(url?: string | null) {
  const enabled = Boolean(url);
  const query = useQuery({
    queryKey: enabled && url ? mediaBlobKey(url) : ["media-blob", null],
    queryFn: ({ signal }) => {
      if (!url) throw new Error("Missing media URL");
      return fetchMediaBlob(url, signal);
    },
    enabled,
    staleTime: MEDIA_BLOB_STALE_TIME,
    gcTime: MEDIA_BLOB_CACHE_TIME,
    retry: 1,
  });

  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!url || !query.data) {
      setObjectUrl(null);
      return;
    }

    const nextObjectUrl = retainObjectUrl(url, query.data);
    setObjectUrl(nextObjectUrl);

    return () => {
      releaseObjectUrl(url);
    };
  }, [query.data, url]);

  useEffect(() => {
    if (!url || !query.isSuccess) return;
    void enforceCacheLimit(MEDIA_BLOB_MAX_ENTRIES);
  }, [query.isSuccess, url]);

  return {
    ...query,
    objectUrl,
  };
}

const VIDEO_EXT_REGEX = /\.(mp4|webm|mov|m4v|mkv|avi)(\?|#|$)/i;

const isVideoLikeUrl = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  if (value.startsWith("data:")) return false;
  if (/^https?:\/\//i.test(value)) return VIDEO_EXT_REGEX.test(value);
  return VIDEO_EXT_REGEX.test(value);
};

export function collectVideoUrls(message: Message): string[] {
  const urls = new Set<string>();
  const media = (message as any)?.media;
  if (media && typeof media === "object") {
    const original = (media as any).original;
    if (isVideoLikeUrl(original)) urls.add(original);
    const preview = (media as any).preview;
    if (isVideoLikeUrl(preview)) urls.add(preview);
  }

  const text = (message.text || "").trim();
  if (text && !text.includes(" ") && isVideoLikeUrl(text)) {
    urls.add(text);
  }

  const reply = (message as any)?.replyTo;
  if (reply && typeof reply === "object") {
    const replyMedia = (reply as any).media;
    const replyOriginal = replyMedia?.original;
    if (isVideoLikeUrl(replyOriginal)) urls.add(replyOriginal);
  }

  return Array.from(urls);
}
