import React from "react";
import { Images } from "@phosphor-icons/react";
import { uploadChatMedia } from "../../services/api";
import { useAuthStore } from "../../stores/authStore";
import { useSocketStore } from "../../stores/socketStore";
import { useComposerStore } from "../../stores/composerStore";
import { useUiStore } from "../../stores/uiStore";
import type { MessageMedia } from "../../types";

// Utility: detect touch-capable device
const isTouchDevice = () =>
  (typeof window !== "undefined" &&
    ("ontouchstart" in window || navigator.maxTouchPoints > 0)) ||
  false;

// NEW: dataURL -> File helper (keeps type if present)
async function dataUrlToFile(
  dataUrl: string,
  filename: string,
  fallbackType = "image/webp"
): Promise<File> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const type = blob.type || fallbackType;
  return new File([blob], filename, { type });
}

// ————————————————
// Thumbnail generators
// ————————————————

async function generateImageThumbnailFromFile(
  file: File,
  maxW = 512,
  maxH = 512,
  mime = "image/webp",
  quality = 0.85
): Promise<{ dataUrl: string; w: number; h: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("image load failed"));
      i.src = url;
    });

    const { width, height } = img;
    if (!width || !height) throw new Error("invalid image dims");

    const scale = Math.min(maxW / width, maxH / height, 1);
    const outW = Math.max(1, Math.floor(width * scale));
    const outH = Math.max(1, Math.floor(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas ctx");

    ctx.drawImage(img, 0, 0, outW, outH);
    const dataUrl = canvas.toDataURL(mime, quality);
    return { dataUrl, w: outW, h: outH };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function generateVideoThumbnailFromFile(
  file: File,
  timeSec = 0.1,
  maxW = 512,
  maxH = 512,
  mime = "image/webp",
  quality = 0.85
): Promise<{ dataUrl: string; w: number; h: number }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    // Load metadata
    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => resolve();
      const onErr = () => reject(new Error("video load failed"));
      video.addEventListener("loadedmetadata", onLoaded, { once: true });
      video.addEventListener("error", onErr, { once: true });
    });

    // Seek to requested time or mid-point if short
    const snapshotTime =
      Number.isFinite(timeSec) && timeSec > 0
        ? timeSec
        : Math.min(0.1, (video.duration || 1) / 2);
    video.currentTime = Math.min(
      snapshotTime,
      Math.max(0, (video.duration || 1) - 0.25)
    );

    await new Promise<void>((resolve) => {
      const onSeeked = () => resolve();
      // Fallback if seeked doesn't fire on some mobile browsers
      const timeout = setTimeout(() => resolve(), 500);
      video.addEventListener(
        "seeked",
        () => {
          clearTimeout(timeout);
          onSeeked();
        },
        { once: true }
      );
    });

    // Draw frame to canvas resized
    const vw = video.videoWidth || 320;
    const vh = video.videoHeight || 180;
    const scale = Math.min(maxW / vw, maxH / vh, 1);
    const outW = Math.max(1, Math.floor(vw * scale));
    const outH = Math.max(1, Math.floor(vh * scale));

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas ctx");

    ctx.drawImage(video, 0, 0, outW, outH);
    const dataUrl = canvas.toDataURL(mime, quality);
    return { dataUrl, w: outW, h: outH };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ————————————————
// MediaUpload: pick + upload + send
// ————————————————
// (inline and modal video controls implemented inside MediaMessage below)

type UploadProps = {
  disabled?: boolean;
  className?: string;
  title?: string;
  // NEW: support direct messages
  mode?: "group" | "dm";
  dmId?: string; // when mode="dm", optionally specify the dmId
};

const MediaUpload: React.FC<UploadProps> = ({
  disabled,
  className,
  title,
  mode = "group",
  dmId,
}) => {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  const username = useAuthStore((s) => s.username);
  const sendMessage = useSocketStore((s) => s.sendMessage);
  const sendDirectMessage = useSocketStore((s) => s.sendDirectMessage);
  const replyTo = useComposerStore((s) => s.replyTarget);
  const showToast = useUiStore((s) => s.showToast);

  const onPick = () => {
    if (busy || disabled) return;
    inputRef.current?.click();
  };

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !username) return;

    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) {
      showToast("Only images or videos are allowed", 2500);
      return;
    }

    try {
      setBusy(true);

      // 1) Generate preview BEFORE upload so we have it regardless
      let previewDataUrl: string | undefined;
      let previewW: number | undefined;
      let previewH: number | undefined;

      if (isImage) {
        try {
          const t = await generateImageThumbnailFromFile(file);
          previewDataUrl = t.dataUrl;
          previewW = t.w;
          previewH = t.h;
        } catch {
          // Best-effort only
        }
      } else if (isVideo) {
        try {
          const t = await generateVideoThumbnailFromFile(file, 0.2);
          previewDataUrl = t.dataUrl;
          previewW = t.w;
          previewH = t.h;
        } catch {
          // Best-effort only
        }
      }

      // 2) Upload original to server
      const { url } = await uploadChatMedia(file, username);

      // 3) If this is a VIDEO and we have a preview dataURL,
      //    convert it to a File and upload to get a real URL.
      let previewUrl: string | undefined;
      if (isVideo && previewDataUrl) {
        try {
          const fname = `${username}-preview-${Date.now()}.webp`;
          const previewFile = await dataUrlToFile(
            previewDataUrl,
            fname,
            "image/webp"
          );
          const uploaded = await uploadChatMedia(previewFile, username);
          previewUrl = uploaded.url; // <- URL instead of base64
        } catch {
          // Fallback to data URL if upload fails (last resort)
          previewUrl = previewDataUrl;
        }
      }

      // 4) Build MessageMedia with URL preview for video (and dims)
      const media: MessageMedia = {
        original: url,
        // For images, we can still use dataURL or skip preview; for videos prefer URL
        ...(previewUrl
          ? { preview: previewUrl }
          : previewDataUrl
          ? { preview: previewDataUrl }
          : {}),
        ...(previewW ? { width: previewW } : {}),
        ...(previewH ? { height: previewH } : {}),
      };

      // 5) Send structured media message (group or DM)
      if (mode === "dm") {
        sendDirectMessage(media.original, replyTo as any, {
          kind: "media",
          media,
          dmId,
        });
      } else {
        sendMessage(media.original, replyTo as any, {
          kind: "media",
          media,
        });
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || "Upload failed";
      showToast(String(msg), 3000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label="Upload image or video"
        title={title || "Upload image or video"}
        className={`pointer-events-auto text-gray-500 transition focus:outline-none focus:ring-2 focus:ring-blue-400 ${
          className || ""
        }`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onPick}
        disabled={disabled || busy}
      >
        <Images size={22} />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple={false}
        onChange={onChange}
        className="hidden"
      />
    </>
  );
};

export default MediaUpload;

// ————————————————
// MediaMessage: render & mobile interactions
// ————————————————

type MediaMessageProps = {
  media: MessageMedia;
  replyMode?: boolean; // shrink when inside a reply bubble
  className?: string;
  onLongPress?: () => void; // open BottomSheet
};

export const MediaMessage: React.FC<MediaMessageProps> = ({
  media,
  replyMode,
  className,
  onLongPress,
}) => {
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const touch = isTouchDevice();
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [isMuted, setIsMuted] = React.useState(true);
  const suppressClickFromTouchRef = React.useRef(false);
  // Modal preview video controls
  const modalVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const [modalPlaying, setModalPlaying] = React.useState(false);
  const [modalMuted, setModalMuted] = React.useState(true);
  // Remember inline playback position/state for modal auto-resume
  const lastTimeRef = React.useRef(0);
  const lastWasPlayingRef = React.useRef(false);

  // Detect long-press for touch
  const pressTimerRef = React.useRef<number | null>(null);
  const longPressFiredRef = React.useRef(false);
  const PRESS_MS = 400;

  const clearPress = () => {
    if (pressTimerRef.current) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    longPressFiredRef.current = false;
  };

  const onTouchStart = () => {
    clearPress();
    pressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      onLongPress?.();
    }, PRESS_MS) as unknown as number;
  };
  const onTouchEnd = () => {
    if (!longPressFiredRef.current) {
      // treat as tap
      if (isVideo) togglePlay();
      else setPreviewOpen(true);
    }
    // prevent the subsequent synthetic click from toggling again
    suppressClickFromTouchRef.current = true;
    window.setTimeout(() => {
      suppressClickFromTouchRef.current = false;
    }, 350);
    clearPress();
  };
  const onTouchMove = () => {
    // cancel on move to avoid accidental long-press while scrolling
    clearPress();
  };

  const origin = media?.original;
  const isVideo = /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(origin || "");
  const dimsClass =
    "rounded-md object-contain w-full block " +
    (replyMode ? "max-h-56" : "max-h-72");
  const rootProps = touch
    ? {
        onTouchStart,
        onTouchEnd,
        onTouchMove,
        onContextMenu: (e: React.MouseEvent) => {
          // Fallback: some mobile browsers fire contextmenu; treat as actions
          e.preventDefault();
          e.stopPropagation();
          onLongPress?.();
        },
      }
    : // Desktop: left-click behavior is preview for images, play/pause for videos;
    // right-click opens message actions sheet for both.
    !isVideo
    ? {
        onClick: () => setPreviewOpen(true),
        onContextMenu: (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          onLongPress?.();
        },
      }
    : {
        onContextMenu: (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          onLongPress?.();
        },
      };

  // Ensure videos start paused; users must click to play
  React.useEffect(() => {
    if (!isVideo) return;
    const v = videoRef.current;
    if (!v) return;
    try {
      v.pause();
    } catch {}
    setIsPlaying(false);
    v.muted = true;
    setIsMuted(true);
  }, []);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      const doPlay = () =>
        v
          .play()
          .then(() => setIsPlaying(true))
          .catch(() => setIsPlaying(false));
      if (v.readyState < 2) {
        const onCanPlay = () => {
          v.removeEventListener("canplay", onCanPlay as any);
          doPlay();
        };
        v.addEventListener("canplay", onCanPlay as any, { once: true } as any);
        try {
          v.load();
        } catch {}
      } else {
        doPlay();
      }
    } else {
      v.pause();
      setIsPlaying(false);
    }
  };

  // Pause inline video whenever the preview modal opens (regardless of how it's opened)
  React.useEffect(() => {
    if (!previewOpen) return;
    const v = videoRef.current;
    if (v && !v.paused) {
      v.pause();
      setIsPlaying(false);
    }
    // Sync modal video to last inline time and autoplay if it was playing
    const mv = modalVideoRef.current;
    if (mv) {
      const targetTime = lastTimeRef.current || 0;
      const shouldAutoplay = lastWasPlayingRef.current;

      const tryPlay = () => {
        if (!shouldAutoplay) return;
        const p = mv.play();
        if (p && typeof (p as any).catch === "function") {
          (p as Promise<void>).catch(() => {});
        }
      };

      const seekThenPlay = () => {
        try {
          mv.currentTime = targetTime;
        } catch {}
        // Wait for seek to land, then attempt play
        const onSeeked = () => {
          mv.removeEventListener("seeked", onSeeked as any);
          // On some browsers, ensure readiness
          if (mv.readyState < 2) {
            const onCanPlay = () => {
              mv.removeEventListener("canplay", onCanPlay as any);
              tryPlay();
            };
            mv.addEventListener(
              "canplay",
              onCanPlay as any,
              { once: true } as any
            );
          } else {
            tryPlay();
          }
        };
        mv.addEventListener("seeked", onSeeked as any, { once: true } as any);
      };

      if (mv.readyState >= 1) {
        seekThenPlay();
      } else {
        const onLoaded = () => {
          mv.removeEventListener("loadedmetadata", onLoaded as any);
          seekThenPlay();
        };
        mv.addEventListener("loadedmetadata", onLoaded as any);
      }
    }
  }, [previewOpen]);

  return (
    <>
      <div className={`${className || ""} w-full`} {...rootProps}>
        {isVideo ? (
          <div
            className="relative block w-full select-none"
            onClick={(e) => {
              e.stopPropagation();
              if (suppressClickFromTouchRef.current) return;
              togglePlay();
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onLongPress?.();
            }}
          >
            <video
              ref={videoRef}
              className={dimsClass}
              playsInline
              preload="metadata"
              muted
              controls={false}
              poster={media.preview || undefined}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onVolumeChange={(e) => {
                const v = e.currentTarget;
                setIsMuted(!!v.muted);
              }}
            >
              <source src={origin} />
            </video>

            {/* Inline volume toggle */}
            <button
              type="button"
              aria-label={isMuted ? "Unmute" : "Mute"}
              title={isMuted ? "Unmute" : "Mute"}
              className="absolute top-2 left-2 rounded-full bg-black/40 text-white p-1.5 backdrop-blur-sm"
              onClick={(e) => {
                e.stopPropagation();
                const v = videoRef.current;
                if (!v) return;
                const next = !v.muted;
                v.muted = next;
                if (!next && v.volume === 0) v.volume = 1;
                setIsMuted(next);
              }}
            >
              {isMuted ? (
                // Speaker off
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.06c1.48-.74 2.5-2.26 2.5-4.03z"
                    opacity=".3"
                  />
                  <path d="M5 9v6h4l5 5V4L9 9H5zm11.59 3l2.7 2.7-1.41 1.41L15.17 13l-2.7 2.7-1.41-1.41L13.76 12 11.06 9.3l1.41-1.41 2.7 2.7 2.71-2.7 1.41 1.41L16.59 12z" />
                </svg>
              ) : (
                // Speaker on
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M3 10v4h4l5 5V5L7 10H3z" />
                  <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.06c1.48-.74 2.5-2.26 2.5-4.03z" />
                  <path d="M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                </svg>
              )}
            </button>

            {/* Center Play overlay when paused (ignore pointer events so clicks hit video/container) */}
            {!isPlaying && (
              <div
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
                aria-hidden="true"
              >
                <div className="rounded-full bg-red-500 p-3">
                  <svg
                    width="34"
                    height="34"
                    viewBox="0 0 24 24"
                    fill="#fff"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path d="M8 5v14l11-7L8 5z" />
                  </svg>
                </div>
              </div>
            )}

            {/* Preview chip */}
            <button
              type="button"
              className="absolute bottom-1 right-1 text-[11px] px-2 py-0.5 rounded text-white bg-black/40 backdrop-blur-sm"
              onClick={(e) => {
                e.stopPropagation();
                // Capture inline position/state and pause when opening preview
                const v = videoRef.current;
                if (v) {
                  lastTimeRef.current = v.currentTime || 0;
                  lastWasPlayingRef.current = !v.paused;
                  if (!v.paused) {
                    v.pause();
                    setIsPlaying(false);
                  }
                }
                setPreviewOpen(true);
              }}
              aria-label="Preview video"
              title="Preview"
            >
              Preview
            </button>
          </div>
        ) : (
          <img
            src={origin}
            alt="attachment"
            className={dimsClass}
            loading="lazy"
            draggable={false}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onLongPress?.();
            }}
          />
        )}
      </div>

      {/* Preview overlay (uses thumbnail if present, else shows image/video directly) */}
      {previewOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPreviewOpen(false)}
        >
          <div
            className="relative w-full max-w-[90vw] max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button removed; click backdrop to close */}
            {/* If it's a video, always render the video element; use preview as poster */}
            {isVideo ? (
              <div
                className="relative block w-full select-none"
                onClick={() => {
                  const v = modalVideoRef.current;
                  if (!v) return;
                  if (v.paused) {
                    const doPlay = () =>
                      v
                        .play()
                        .then(() => setModalPlaying(true))
                        .catch(() => {});
                    if (v.readyState < 2) {
                      const onCanPlay = () => {
                        v.removeEventListener("canplay", onCanPlay as any);
                        doPlay();
                      };
                      v.addEventListener(
                        "canplay",
                        onCanPlay as any,
                        { once: true } as any
                      );
                      try {
                        v.load();
                      } catch {}
                    } else {
                      doPlay();
                    }
                  } else {
                    v.pause();
                    setModalPlaying(false);
                  }
                }}
              >
                {/* Modal video (click anywhere or use button below to toggle) */}
                <video
                  ref={modalVideoRef}
                  className="max-w-full max-h-[80vh] rounded-md object-contain"
                  playsInline
                  preload="auto"
                  controls={false}
                  muted
                  poster={media.preview || undefined}
                  onPlay={() => setModalPlaying(true)}
                  onPause={() => setModalPlaying(false)}
                  onVolumeChange={(e) => {
                    const v = e.currentTarget;
                    setModalMuted(!!v.muted);
                  }}
                >
                  <source src={origin} />
                </video>

                {/* Modal volume toggle */}
                <button
                  type="button"
                  aria-label={modalMuted ? "Unmute" : "Mute"}
                  title={modalMuted ? "Unmute" : "Mute"}
                  className="absolute top-3 left-3 rounded-full bg-black/40 text-white p-2 backdrop-blur-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    const v = modalVideoRef.current;
                    if (!v) return;
                    const next = !v.muted;
                    v.muted = next;
                    if (!next && v.volume === 0) v.volume = 1;
                    setModalMuted(next);
                  }}
                >
                  {modalMuted ? (
                    // Speaker off
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.06c1.48-.74 2.5-2.26 2.5-4.03z"
                        opacity=".3"
                      />
                      <path d="M5 9v6h4l5 5V4L9 9H5zm11.59 3l2.7 2.7-1.41 1.41L15.17 13l-2.7 2.7-1.41-1.41L13.76 12 11.06 9.3l1.41-1.41 2.7 2.7 2.71-2.7 1.41 1.41L16.59 12z" />
                    </svg>
                  ) : (
                    // Speaker on
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path d="M3 10v4h4l5 5V5L7 10H3z" />
                      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.06c1.48-.74 2.5-2.26 2.5-4.03z" />
                      <path d="M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                    </svg>
                  )}
                </button>
                {!modalPlaying && (
                  <div
                    className="absolute inset-0 flex items-center justify-center pointer-events-none"
                    aria-hidden
                  >
                    <div className="rounded-full bg-red-500 p-4">
                      <svg
                        width="40"
                        height="40"
                        viewBox="0 0 24 24"
                        fill="#fff"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path d="M8 5v14l11-7L8 5z" />
                      </svg>
                    </div>
                  </div>
                )}
                {/* Bottom play/pause button removed; use overlay or click area to toggle */}
              </div>
            ) : (
              // Non-video: prefer preview still if available
              <img
                src={media.preview || origin}
                alt="attachment"
                className="max-w-full max-h-[80vh] rounded-md object-contain"
              />
            )}
          </div>
        </div>
      )}
    </>
  );
};
