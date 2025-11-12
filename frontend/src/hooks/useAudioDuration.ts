import { useEffect, useMemo, useState } from "react";

const durationCache = new Map<string, number>();

const isValidDuration = (value?: number | null) =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export function useAudioDuration(
  url?: string,
  initialDurationMs?: number | null
): number | undefined {
  const normalizedUrl = url || undefined;

  const cached = useMemo(() => {
    if (!normalizedUrl) return undefined;
    if (isValidDuration(initialDurationMs)) {
      durationCache.set(normalizedUrl, initialDurationMs!);
      return initialDurationMs ?? undefined;
    }
    if (durationCache.has(normalizedUrl)) {
      return durationCache.get(normalizedUrl);
    }
    return undefined;
  }, [normalizedUrl, initialDurationMs]);

  const [duration, setDuration] = useState<number | undefined>(cached);

  useEffect(() => {
    if (!normalizedUrl) {
      setDuration(
        isValidDuration(initialDurationMs)
          ? initialDurationMs ?? undefined
          : undefined
      );
      return;
    }
    if (isValidDuration(initialDurationMs)) {
      durationCache.set(normalizedUrl, initialDurationMs!);
      setDuration(initialDurationMs ?? undefined);
      return;
    }
    const fromCache = durationCache.get(normalizedUrl);
    if (isValidDuration(fromCache)) {
      setDuration(fromCache);
      return;
    }

    let cancelled = false;
    const audio = new Audio();
    audio.preload = "metadata";
    audio.crossOrigin = "anonymous";
    audio.src = normalizedUrl;
    try {
      audio.load();
    } catch {}

    const updateFromElement = () => {
      if (cancelled) return;
      const sec = audio.duration;
      if (isValidDuration(sec)) {
        const ms = Math.round(sec * 1000);
        durationCache.set(normalizedUrl, ms);
        setDuration(ms);
      }
    };

    const handleError = () => {
      if (cancelled) return;
      const fallback = durationCache.get(normalizedUrl);
      if (isValidDuration(fallback)) {
        setDuration(fallback);
      }
    };

    audio.addEventListener("loadedmetadata", updateFromElement);
    audio.addEventListener("durationchange", updateFromElement);
    audio.addEventListener("error", handleError);

    return () => {
      cancelled = true;
      audio.removeEventListener("loadedmetadata", updateFromElement);
      audio.removeEventListener("durationchange", updateFromElement);
      audio.removeEventListener("error", handleError);
      try {
        audio.pause();
      } catch {}
      try {
        audio.src = "";
      } catch {}
    };
  }, [normalizedUrl, initialDurationMs]);

  return duration;
}
