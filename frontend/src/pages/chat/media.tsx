import React from "react";
import { useCachedMediaBlob } from "../../hooks/useCachedMediaBlob";
import type { Message } from "../../types";
import { LARGE_MEDIA_THRESHOLD } from "./chatConstants";
import type { AnimatedSources } from "./types";

const GIF_SINGLE_REGEX = /\.(gif)(\?|#|$)/i;

export function isGifUrl(str: string): boolean {
  if (!/^https?:\/\//i.test(str)) return false;
  return (
    GIF_SINGLE_REGEX.test(str) ||
    /tenor\.com\/.*\.gif/i.test(str) ||
    /media\.giphy\.com\/media\//i.test(str)
  );
}

export function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url);
}

export function isImageUrl(url: string): boolean {
  return /\.(png|jpe?g|webp|avif|heic|heif|bmp)(\?|#|$)/i.test(url);
}

export function isGifOnlyMessage(m: Message): boolean {
  const structuredGif = (m as any).kind === "gif" && (m as any).media;
  const trimmed = (m.text || "").trim();
  const singleGifUrl = !!trimmed && isGifUrl(trimmed) && !trimmed.includes(" ");
  return Boolean(structuredGif || singleGifUrl);
}

export function isVoiceNoteMessage(m: Message): boolean {
  const kind = (m as any).kind;
  if (kind === "audio") return true;
  const audio = (m as any).audio;
  return Boolean(audio && typeof audio === "object");
}

export function isMediaAttachmentMessage(m: Message): boolean {
  const media = (m as any).media;
  if (media && typeof media === "object") {
    const kind = (m as any).kind;
    if (kind === "audio") return false;
    return true;
  }
  const trimmed = (m.text || "").trim();
  if (!trimmed || trimmed.includes(" ")) return false;
  if (isGifUrl(trimmed)) return true;
  if (isVideoUrl(trimmed)) return true;
  if (isImageUrl(trimmed)) return true;
  return false;
}

export function deriveAnimatedSources(gifUrl: string): AnimatedSources | null {
  if (!isGifUrl(gifUrl)) return null;
  const queryIndex = gifUrl.indexOf("?");
  const query = queryIndex !== -1 ? gifUrl.slice(queryIndex) : "";
  const base = gifUrl.replace(/(\.gif)(\?.*)?$/i, "");
  return {
    gif: gifUrl,
    mp4: `${base}.mp4${query}`,
    webm: `${base}.webm${query}`,
  };
}

export const AnimatedMedia: React.FC<{
  url: string;
  large?: boolean;
  mediaSources?: {
    mp4?: string;
    webm?: string;
    gif?: string;
    preview?: string;
  };
}> = ({ url, large, mediaSources }) => {
  const [videoReady, setVideoReady] = React.useState(false);
  const [showVideo, setShowVideo] = React.useState(false);
  const [tooLarge, setTooLarge] = React.useState(false);
  const [checkedSize, setCheckedSize] = React.useState(false);

  const derived: AnimatedSources | null = mediaSources
    ? {
        gif: mediaSources.gif || url,
        mp4: mediaSources.mp4,
        webm: mediaSources.webm,
        preview: mediaSources.preview,
      }
    : deriveAnimatedSources(url);

  const dimsClass =
    "rounded-md shadow-sm object-contain w-auto max-w-full h-auto mx-auto";

  const containerClasses = large
    ? "flex flex-col w-full max-w-full bg-black rounded-md overflow-hidden"
    : "inline-block my-1 w-full max-w-full bg-black rounded-md overflow-hidden";

  React.useEffect(() => {
    let abort = false;
    (async () => {
      if (!derived?.mp4 || checkedSize) return;
      try {
        const res = await fetch(derived.mp4, { method: "HEAD" });
        const lenStr = res.headers.get("Content-Length");
        if (!abort && lenStr) {
          const size = parseInt(lenStr, 10);
          if (size && size > LARGE_MEDIA_THRESHOLD) {
            setTooLarge(true);
          }
        }
      } catch {
        // ignore network errors
      } finally {
        if (!abort) setCheckedSize(true);
      }
    })();
    return () => {
      abort = true;
    };
  }, [derived?.mp4, checkedSize]);

  React.useEffect(() => {
    if (videoReady && !tooLarge) {
      setShowVideo(true);
    }
  }, [videoReady, tooLarge]);

  const fetchableMp4 = React.useMemo(() => {
    if (!derived?.mp4) return null;
    if (!checkedSize) return null;
    if (tooLarge && !showVideo) return null;
    return derived.mp4;
  }, [derived?.mp4, checkedSize, tooLarge, showVideo]);

  const { objectUrl: cachedMp4Url } = useCachedMediaBlob(fetchableMp4);

  if (!derived) {
    return (
      <img
        src={url}
        alt="GIF"
        loading="lazy"
        className={dimsClass}
        draggable={false}
      />
    );
  }

  const stillSrc = derived.preview || derived.gif || url;

  return (
    <div className={containerClasses}>
      <img
        src={stillSrc}
        alt="GIF"
        className={`${dimsClass} ${showVideo && videoReady ? "hidden" : ""}`}
        loading="lazy"
        draggable={false}
      />

      {(!tooLarge || showVideo) && (
        <video
          className={`${dimsClass} ${showVideo && videoReady ? "" : "hidden"}`}
          autoPlay
          loop
          muted
          playsInline
          controls={false}
          onCanPlay={() => setVideoReady(true)}
          onError={() => {
            setVideoReady(false);
            setShowVideo(false);
          }}
        >
          {derived.mp4 && (
            <source src={cachedMp4Url ?? derived.mp4} type="video/mp4" />
          )}
          {derived.webm && <source src={derived.webm} type="video/webm" />}
        </video>
      )}

      {tooLarge && !showVideo && (
        <div className="mt-2 flex items-center gap-2">
          <div className="text-xs text-gray-600">
            Large media (~&gt;{(LARGE_MEDIA_THRESHOLD / 1024 / 1024).toFixed(0)}{" "}
            MB). Load anyway?
          </div>
          <button
            type="button"
            onClick={() => setShowVideo(true)}
            className="px-3 py-1.5 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700"
          >
            Load
          </button>
        </div>
      )}
    </div>
  );
};

export default AnimatedMedia;
