import React from "react";
import { useTapGesture } from "../../hooks/useTapGesture";
import {
  DownloadSimple,
  Images,
  Pause,
  Play,
  SpeakerHigh,
  SpeakerX,
  X,
} from "@phosphor-icons/react";
import { uploadChatMedia } from "../../services/api";
import { useAuthStore } from "../../stores/authStore";
import { useSocketStore } from "../../stores/socketStore";
import { useComposerStore } from "../../stores/composerStore";
import { useUiStore } from "../../stores/uiStore";
import type { MessageMedia } from "../../types";
import { useMessageStore } from "../../stores/messageStore";
import LoadingSpinner from "../ui/LoadingSpinner";
import { useCachedMediaBlob } from "../../hooks/useCachedMediaBlob";
import RelativeTime from "./RelativeTime";

const OVERLAY_MEDIA_WIDTH = "w-screen max-w-[100vw] min-w-0";
const OVERLAY_MEDIA_HEIGHT = "max-h-screen";
const OVERLAY_MEDIA_ASPECT = "object-contain";

const normalizeDuration = (duration: number | undefined | null): number => {
  if (
    typeof duration !== "number" ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    return 0;
  }
  return duration;
};

const formatTimestamp = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

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
  variant?: "icon" | "menu";
  label?: string;
  onRequestClose?: () => void;
  menuIcon?: React.ReactNode;
  onRegisterTrigger?: (trigger: (() => void) | null) => void;
  pickOverride?: () => void;
  onBusyChange?: (busy: boolean) => void;
  allowVideo?: boolean;
};

export type MediaUploadProps = UploadProps;

export type MediaPreviewMeta = {
  username: string;
  avatarUrl?: string | null;
  timestamp?: number | string | Date | null;
};

const MediaUpload: React.FC<UploadProps> = ({
  disabled,
  className,
  title,
  mode = "group",
  dmId,
  variant = "icon",
  label,
  onRequestClose,
  menuIcon,
  onRegisterTrigger,
  pickOverride,
  onBusyChange,
  allowVideo = false,
}) => {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  const username = useAuthStore((s) => s.username);
  const sendMessage = useSocketStore((s) => s.sendMessage);
  const sendDirectMessage = useSocketStore((s) => s.sendDirectMessage);
  const activeGroupId = useSocketStore((s) => s.activeGroupId);
  const replyTo = useComposerStore((s) => s.replyTarget);
  const showToast = useUiStore((s) => s.showToast);

  const resolvedTitle =
    title || (allowVideo ? "Upload image or video" : "Upload image");
  const resolvedLabel = label || (allowVideo ? "Photo or video" : "Photo");
  const acceptTypes = allowVideo ? "image/*,video/*" : "image/*";

  React.useEffect(() => {
    if (!onRegisterTrigger) return;
    const trigger = () => {
      if (busy || disabled) return;
      inputRef.current?.click();
    };
    onRegisterTrigger(trigger);
    return () => {
      onRegisterTrigger(null);
    };
  }, [onRegisterTrigger, busy, disabled]);

  const onPick = () => {
    if (busy || disabled) return;
    if (pickOverride) {
      pickOverride();
      return;
    }
    inputRef.current?.click();
  };

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !username) return;

    const isVideo = file.type.startsWith("video/");
    const isImage = file.type.startsWith("image/");
    if (!isImage && !isVideo) {
      showToast("Only images or videos are allowed", 2500);
      return;
    }
    if (isVideo && !allowVideo) {
      showToast("Video uploads are disabled for this chat", 2500);
      return;
    }

    const threadId = mode === "dm" ? dmId || "" : activeGroupId || "";
    if (!threadId) {
      showToast("Join a conversation before uploading media", 2500);
      return;
    }

    onRequestClose?.();

    let localId: string | null = null;

    try {
      setBusy(true);
      onBusyChange?.(true);

      localId = `loc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const replySnapshot = replyTo
        ? (() => {
            const snapshot: any = {
              ...((replyTo as any)?.messageId
                ? { messageId: (replyTo as any).messageId }
                : {}),
              username: (replyTo as any)?.username,
              text: (replyTo as any)?.text || "",
              timestamp:
                (replyTo as any)?.timestamp ??
                (replyTo as any)?.createdAt ??
                null,
            };
            if ((replyTo as any)?.kind) {
              snapshot.kind = (replyTo as any).kind;
            }
            if ((replyTo as any)?.deleted) {
              snapshot.deleted = true;
              snapshot.text = "";
              if ((replyTo as any)?.deletedAt) {
                snapshot.deletedAt = (replyTo as any).deletedAt;
              }
            }
            if (!snapshot.deleted) {
              if ((replyTo as any)?.media) {
                snapshot.media = (replyTo as any).media;
              }
              if ((replyTo as any)?.audio) {
                snapshot.audio = (replyTo as any).audio;
              }
            }
            return snapshot;
          })()
        : null;

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

      const optimisticMedia: MessageMedia = {
        original: previewDataUrl || "",
        ...(previewDataUrl
          ? { preview: previewDataUrl, placeholder: previewDataUrl }
          : {}),
        ...(previewW ? { width: previewW } : {}),
        ...(previewH ? { height: previewH } : {}),
        ...(file.type ? { type: file.type } : {}),
        uploading: true,
      };

      const messageStore = useMessageStore.getState() as any;
      const existing = (messageStore.messages[threadId] || []) as any[];
      const optimisticMessage: any = {
        localId,
        username,
        text: "",
        timestamp: Date.now(),
        kind: "media",
        media: optimisticMedia,
        ...(replySnapshot ? { replyTo: replySnapshot } : {}),
        ...(mode === "dm" && dmId ? { dmId } : {}),
      };
      messageStore.setMessages(threadId, [...existing, optimisticMessage]);

      // 2) Upload original to server
      const { url, type: uploadedType } = await uploadChatMedia(file, username);

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
          // Fallback to the original Cloudinary asset if preview upload fails
          previewUrl = url;
        }
      }

      const previewRemote = previewUrl || (previewDataUrl ? url : undefined);

      // 4) Build MessageMedia with URL preview for video (and dims)
      const media: MessageMedia = {
        original: url,
        // Always send a hosted URL for preview fields (fallback to original asset)
        ...(previewRemote ? { preview: previewRemote } : {}),
        ...(previewW ? { width: previewW } : {}),
        ...(previewH ? { height: previewH } : {}),
        ...(uploadedType
          ? { type: uploadedType }
          : file.type
          ? { type: file.type }
          : {}),
      };

      // 5) Send structured media message (group or DM)
      if (mode === "dm") {
        sendDirectMessage(media.original, replyTo as any, {
          kind: "media",
          media,
          dmId,
          localId,
        });
      } else {
        sendMessage(media.original, replyTo as any, {
          kind: "media",
          media,
          localId,
        });
      }
    } catch (err: any) {
      if (threadId && localId) {
        const messageStore = useMessageStore.getState() as any;
        const current = (messageStore.messages[threadId] || []) as any[];
        const filtered = current.filter(
          (m: any) => (m as any).localId !== localId
        );
        if (filtered.length !== current.length) {
          messageStore.setMessages(threadId, filtered);
        }
      }
      const msg = err?.response?.data?.error || err?.message || "Upload failed";
      showToast(String(msg), 3000);
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label={
          variant === "menu" ? resolvedLabel || resolvedTitle : resolvedTitle
        }
        title={resolvedTitle}
        className={`pointer-events-auto transition focus:outline-none ${
          variant === "icon"
            ? "text-red-500 focus:ring-2 focus:ring-red-300 hover:text-red-600"
            : "hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-300"
        } ${className || ""}`.trim()}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onPick}
        disabled={disabled || busy}
      >
        {variant === "menu" ? (
          <span className="flex w-full items-center gap-2 text-gray-900">
            {menuIcon || (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-green-600">
                <Images size={18} weight="fill" />
              </span>
            )}
            <span className="font-medium">
              {resolvedLabel || "Media"}
              {busy ? "..." : ""}
            </span>
          </span>
        ) : (
          <Images size={22} weight="fill" />
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={acceptTypes}
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
  onDoubleTap?: (anchor?: HTMLElement | null) => void; // open reaction modal
  overlayMeta?: MediaPreviewMeta;
};

export const MediaMessage = React.memo(function MediaMessage({
  media,
  replyMode,
  className,
  onLongPress,
  onDoubleTap,
  overlayMeta,
}: MediaMessageProps) {
  const baseWidth =
    typeof media?.width === "number" && media.width > 0 ? media.width : null;
  const baseHeight =
    typeof media?.height === "number" && media.height > 0 ? media.height : null;
  const initialAspect = baseWidth && baseHeight ? baseWidth / baseHeight : null;
  const [inlineAspect, setInlineAspect] = React.useState<number | null>(() =>
    typeof initialAspect === "number" &&
    Number.isFinite(initialAspect) &&
    initialAspect > 0
      ? initialAspect
      : null
  );

  const aspectStyle = inlineAspect
    ? ({ aspectRatio: inlineAspect } as React.CSSProperties)
    : undefined;
  const hasAspect = inlineAspect != null;

  const dimsClass = "rounded-xl object-contain w-full h-full block";
  const placeholderContainerClass = [
    "relative w-full overflow-hidden rounded-xl bg-black",
    !hasAspect ? (replyMode ? "min-h-[140px]" : "min-h-[200px]") : "",
    className || "",
  ]
    .filter(Boolean)
    .join(" ");
  const rootClasses = [
    "relative w-full bg-black rounded-xl overflow-hidden",
    className || "",
  ]
    .filter(Boolean)
    .join(" ");
  const origin = media?.original;
  const placeholderSrc = media?.placeholder || media?.preview || null;
  const previewSrc = placeholderSrc || origin || "";
  const mediaType = (media?.type || "").toLowerCase();
  const isVideo =
    mediaType.startsWith("video/") ||
    /(\.(mp4|webm|mov|m4v|mkv|avi))(\?|#|$)/i.test(origin || "");
  const isImage =
    !isVideo &&
    (mediaType.startsWith("image/") ||
      /(\.(png|jpe?g|gif|webp|avif|heic|svg))(\?|#|$)/i.test(origin || ""));

  const shouldCacheMedia = Boolean(
    origin &&
      !origin.startsWith("data:") &&
      !origin.startsWith("blob:") &&
      (isVideo || isImage)
  );

  const overlayUsername =
    typeof overlayMeta?.username === "string"
      ? overlayMeta.username.trim()
      : "";
  const overlayAvatar = overlayMeta?.avatarUrl || null;

  const normalizedTimestamp = React.useMemo(() => {
    const raw = overlayMeta?.timestamp;
    if (raw == null) return null;
    if (raw instanceof Date) return raw.getTime();
    if (typeof raw === "number") {
      return raw < 1_000_000_000_000 ? raw * 1000 : raw;
    }
    if (typeof raw === "string") {
      const numeric = Number(raw);
      if (Number.isFinite(numeric)) {
        return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
      }
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed)) return parsed;
      return null;
    }
    return null;
  }, [overlayMeta?.timestamp]);

  const timestampValue = normalizedTimestamp ?? overlayMeta?.timestamp ?? null;

  const absoluteTimestampLabel = React.useMemo(() => {
    if (normalizedTimestamp == null) return null;
    try {
      return new Date(normalizedTimestamp).toLocaleString();
    } catch {
      return null;
    }
  }, [normalizedTimestamp]);

  const overlayInitial = overlayUsername
    ? overlayUsername[0].toUpperCase()
    : "?";

  const { objectUrl: cachedMediaUrl } = useCachedMediaBlob(
    shouldCacheMedia ? origin : null
  );

  const cachedVideoUrl = isVideo ? cachedMediaUrl : null;
  const cachedImageUrl = isImage ? cachedMediaUrl : null;
  const resolvedImageSrc = cachedImageUrl || origin || "";
  const shouldCacheVideo = Boolean(isVideo && shouldCacheMedia);

  const [useCachedSrc, setUseCachedSrc] = React.useState<boolean>(() =>
    Boolean(cachedVideoUrl)
  );
  const hasStartedPlaybackRef = React.useRef(false);

  React.useEffect(() => {
    if (!shouldCacheVideo) {
      if (useCachedSrc) setUseCachedSrc(false);
      return;
    }
    if (!cachedVideoUrl) return;
    if (useCachedSrc) return;
    if (hasStartedPlaybackRef.current) return;
    setUseCachedSrc(true);
  }, [cachedVideoUrl, shouldCacheVideo, useCachedSrc]);

  const resolvedVideoSrc = useCachedSrc ? cachedVideoUrl || origin : origin;

  React.useEffect(() => {
    if (
      typeof initialAspect === "number" &&
      Number.isFinite(initialAspect) &&
      initialAspect > 0
    ) {
      setInlineAspect(initialAspect);
    } else if (!initialAspect) {
      setInlineAspect(null);
    }
  }, [initialAspect, isVideo, origin]);

  React.useEffect(() => {
    if (!isVideo) return;
    setVideoReady(false);
    hasStartedPlaybackRef.current = false;
  }, [isVideo, useCachedSrc, origin]);
  const isUploading = Boolean(media?.uploading);
  const [videoReady, setVideoReady] = React.useState(() => !isVideo);
  const [modalVideoReady, setModalVideoReady] = React.useState(false);

  const [previewOpen, setPreviewOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [isMuted, setIsMuted] = React.useState(true);
  // Modal preview video controls
  const modalVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const [modalPlaying, setModalPlaying] = React.useState(false);
  const [modalMuted, setModalMuted] = React.useState(true);
  const [modalUiVisible, setModalUiVisible] = React.useState(true);
  const [downloading, setDownloading] = React.useState(false);
  const [modalDuration, setModalDuration] = React.useState(0);
  const [modalCurrentTime, setModalCurrentTime] = React.useState(0);
  const [isScrubbing, setIsScrubbing] = React.useState(false);
  // Track modal orientation so portrait clips can fill the viewport without letterboxing
  const [modalPortrait, setModalPortrait] = React.useState(false);
  // Remember inline playback position/state for modal auto-resume
  const lastTimeRef = React.useRef(0);
  const lastWasPlayingRef = React.useRef(false);
  const progressBarRef = React.useRef<HTMLDivElement | null>(null);
  const scrubbingRef = React.useRef(false);
  const scrubWasPlayingRef = React.useRef(false);

  const openPreview = () => {
    const v = videoRef.current;
    if (v) {
      lastTimeRef.current = v.currentTime || 0;
      lastWasPlayingRef.current = !v.paused;
      if (!v.paused) {
        try {
          v.pause();
        } catch {}
        setIsPlaying(false);
      }
    }
    setModalUiVisible(true);
    setPreviewOpen(true);
  };

  const seekByClientX = React.useCallback((clientX: number) => {
    const bar = progressBarRef.current;
    const video = modalVideoRef.current;
    if (!bar || !video) {
      return;
    }
    const duration = normalizeDuration(video.duration);
    if (!duration) return;
    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    const newTime = ratio * duration;
    video.currentTime = newTime;
    setModalCurrentTime(newTime);
  }, []);

  const handleProgressPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!modalVideoRef.current) return;
      const video = modalVideoRef.current;
      if (!normalizeDuration(video.duration)) return;
      event.preventDefault();
      event.stopPropagation();
      scrubWasPlayingRef.current = !video.paused;
      if (scrubWasPlayingRef.current) {
        try {
          video.pause();
        } catch {}
        setModalPlaying(false);
      }
      scrubbingRef.current = true;
      setIsScrubbing(true);
      if (progressBarRef.current) {
        try {
          progressBarRef.current.setPointerCapture(event.pointerId);
        } catch {}
      }
      seekByClientX(event.clientX);
    },
    [seekByClientX]
  );

  const handleProgressPointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!scrubbingRef.current) return;
      event.preventDefault();
      seekByClientX(event.clientX);
    },
    [seekByClientX]
  );

  const endScrub = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>, shouldUpdate = true) => {
      if (!scrubbingRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      if (shouldUpdate) {
        seekByClientX(event.clientX);
      }
      if (progressBarRef.current) {
        try {
          progressBarRef.current.releasePointerCapture(event.pointerId);
        } catch {}
      }
      scrubbingRef.current = false;
      setIsScrubbing(false);
      const video = modalVideoRef.current;
      if (!video) {
        scrubWasPlayingRef.current = false;
        return;
      }
      if (scrubWasPlayingRef.current) {
        video
          .play()
          .then(() => setModalPlaying(true))
          .catch(() => {});
      } else {
        setModalPlaying(!video.paused);
      }
      scrubWasPlayingRef.current = false;
    },
    [seekByClientX]
  );

  const handleProgressPointerUp = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      endScrub(event, true);
    },
    [endScrub]
  );

  const handleProgressPointerCancel = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      endScrub(event, false);
    },
    [endScrub]
  );

  const progressPercent = React.useMemo(() => {
    if (!modalDuration || modalDuration <= 0) return 0;
    const ratio = modalCurrentTime / modalDuration;
    if (!Number.isFinite(ratio)) return 0;
    return Math.min(Math.max(ratio, 0), 1);
  }, [modalCurrentTime, modalDuration]);

  const progressLabel = React.useMemo(() => {
    if (!modalDuration || modalDuration <= 0) return "0:00 / 0:00";
    return `${formatTimestamp(modalCurrentTime)} / ${formatTimestamp(
      modalDuration
    )}`;
  }, [modalCurrentTime, modalDuration]);

  const progressPercentValue = React.useMemo(
    () => progressPercent * 100,
    [progressPercent]
  );
  const progressPercentCss = `${progressPercentValue}%`;

  const handleProgressKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const video = modalVideoRef.current;
      if (!video) return;
      const duration = normalizeDuration(video.duration);
      if (!duration) return;
      let delta = 0;
      switch (event.key) {
        case "ArrowLeft":
          delta = -5;
          break;
        case "ArrowRight":
          delta = 5;
          break;
        case "Home":
          delta = -(video.currentTime || 0);
          break;
        case "End":
          delta = duration - (video.currentTime || 0);
          break;
        default:
          return;
      }
      event.preventDefault();
      const newTime = Math.min(
        Math.max((video.currentTime || 0) + delta, 0),
        duration
      );
      video.currentTime = newTime;
      setModalCurrentTime(newTime);
    },
    [modalDuration]
  );

  const toggleModalPlayback = React.useCallback(() => {
    const video = modalVideoRef.current;
    if (!video) return;
    if (video.paused) {
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        (playPromise as Promise<void>).catch(() => {});
      }
    } else {
      video.pause();
    }
  }, []);

  const [displaySrc, setDisplaySrc] = React.useState(
    () => placeholderSrc || origin || ""
  );
  const [fullResLoaded, setFullResLoaded] = React.useState(() => {
    if (isVideo) return true;
    if (!origin) return true;
    return !placeholderSrc || placeholderSrc === origin;
  });

  React.useEffect(() => {
    if (isVideo) return;
    let cancelled = false;
    const fallback = placeholderSrc || "";

    const targetSrc = cachedImageUrl || origin;

    if (!targetSrc) {
      setDisplaySrc(fallback);
      setFullResLoaded(true);
      return () => {
        cancelled = true;
      };
    }

    if (!placeholderSrc || placeholderSrc === targetSrc) {
      setDisplaySrc(targetSrc);
      setFullResLoaded(true);
      return () => {
        cancelled = true;
      };
    }

    setDisplaySrc(fallback);
    setFullResLoaded(false);

    const img = new Image();
    img.src = targetSrc;

    let settled = false;
    const finalizeSuccess = () => {
      if (cancelled || settled) return;
      settled = true;
      setDisplaySrc(targetSrc);
      setFullResLoaded(true);
    };

    const finalizeFailure = () => {
      if (cancelled || settled) return;
      settled = true;
      setFullResLoaded(true);
    };

    img.onload = finalizeSuccess;
    img.onerror = finalizeFailure;
    if (typeof img.decode === "function") {
      img.decode().then(finalizeSuccess).catch(finalizeFailure);
    }

    return () => {
      cancelled = true;
    };
  }, [origin, placeholderSrc, isVideo, cachedImageUrl]);

  React.useEffect(() => {
    setVideoReady(!isVideo);
  }, [isVideo, origin]);

  React.useEffect(() => {
    if (!isVideo) {
      setModalVideoReady(true);
      setModalPortrait(false);
      return;
    }
    setModalVideoReady(false);
    setModalPortrait(false);
  }, [isVideo, origin, previewOpen]);

  React.useEffect(() => {
    if (!previewOpen) {
      setDownloading(false);
      setModalDuration(0);
      setModalCurrentTime(0);
      setIsScrubbing(false);
      scrubbingRef.current = false;
      scrubWasPlayingRef.current = false;
      setModalUiVisible(true);
    }
  }, [previewOpen]);

  React.useEffect(() => {
    const video = modalVideoRef.current;
    if (!video) return;
    const handleTimeUpdate = () => {
      if (!scrubbingRef.current) {
        setModalCurrentTime(video.currentTime || 0);
      }
    };
    const handleDurationChange = () => {
      setModalDuration(normalizeDuration(video.duration));
    };
    const handleEnded = () => {
      setModalPlaying(false);
      setModalCurrentTime(0);
      setModalDuration((prev) => normalizeDuration(prev));
      if (video) {
        try {
          video.currentTime = 0;
        } catch {}
      }
    };
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("durationchange", handleDurationChange);
    video.addEventListener("ended", handleEnded);
    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("durationchange", handleDurationChange);
      video.removeEventListener("ended", handleEnded);
    };
  }, [previewOpen]);

  const gestureHandlers = useTapGesture({
    onSingleTap: () => openPreview(),
    onDoubleTap: () => {
      if (onDoubleTap) onDoubleTap(containerRef.current ?? null);
      else onLongPress?.();
    },
    onLongPress: () => onLongPress?.(),
    doubleTapMs: 250,
    longPressMsTouch: 450,
    longPressMsMouse: 650,
    moveTolerancePx: 10,
    stopPropagation: true,
    preventDefault: false,
  });

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

  const togglePlay = (opts?: { allowAutoStart?: boolean }) => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (!opts?.allowAutoStart) return;
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
        setModalCurrentTime(targetTime);
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

  const handleInlinePlay = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    togglePlay({ allowAutoStart: v.paused });
  };

  const guessExtensionFromMime = (mime?: string | null) => {
    if (!mime) return null;
    const map: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
      "image/avif": "avif",
      "image/heic": "heic",
      "image/heif": "heif",
      "video/mp4": "mp4",
      "video/webm": "webm",
      "video/quicktime": "mov",
      "video/x-m4v": "m4v",
      "video/mpeg": "mpg",
      "video/x-msvideo": "avi",
      "video/x-matroska": "mkv",
    };
    return map[mime.toLowerCase()] || null;
  };

  const filenameFromUrl = (url: string): string | null => {
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname || "";
      const candidate = pathname.split("/").filter(Boolean).pop();
      if (!candidate) return null;
      const clean = candidate.split("?")[0].split("#")[0];
      return clean || null;
    } catch {
      return null;
    }
  };

  const triggerDownload = (href: string, name: string) => {
    const link = document.createElement("a");
    link.href = href;
    link.download = name;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownload = React.useCallback(
    async (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (!origin) return;
      setDownloading(true);

      let blobUrl: string | null = null;
      try {
        const fallbackBase = isVideo ? "video" : "image";
        const existingName = filenameFromUrl(origin);

        if (origin.startsWith("data:")) {
          triggerDownload(
            origin,
            existingName || `${fallbackBase}-${Date.now()}`
          );
          return;
        }

        if (origin.startsWith("blob:")) {
          triggerDownload(
            origin,
            existingName || `${fallbackBase}-${Date.now()}`
          );
          return;
        }

        const targetUrl = new URL(origin, window.location.href);
        const sameOrigin = targetUrl.origin === window.location.origin;
        const response = await fetch(origin, {
          credentials: sameOrigin ? "include" : "omit",
          mode: sameOrigin ? "same-origin" : "cors",
        });
        if (!response.ok) {
          throw new Error(`Download failed (${response.status})`);
        }
        const blob = await response.blob();
        blobUrl = URL.createObjectURL(blob);
        const mimeExt = guessExtensionFromMime(blob.type);
        const baseName = existingName || `${fallbackBase}-${Date.now()}`;
        const hasExt = /\.[A-Za-z0-9]{2,5}$/i.test(baseName);
        const fileName = hasExt
          ? baseName
          : `${baseName}.${mimeExt || (isVideo ? "mp4" : "jpg")}`;
        triggerDownload(blobUrl, fileName);
      } catch (err) {
        console.error("Failed to download media", err);
        useUiStore
          .getState()
          .showToast("Unable to download. Opened in new tab instead.", 3000);
        try {
          const alt = document.createElement("a");
          alt.href = origin;
          alt.target = "_blank";
          alt.rel = "noopener";
          document.body.appendChild(alt);
          alt.click();
          document.body.removeChild(alt);
        } catch {}
      } finally {
        if (blobUrl) {
          try {
            URL.revokeObjectURL(blobUrl);
          } catch {}
        }
        setDownloading(false);
      }
    },
    [origin, isVideo]
  );

  if (isUploading) {
    return (
      <div
        className={placeholderContainerClass}
        aria-live="polite"
        style={aspectStyle}
      >
        {previewSrc ? (
          <img
            src={previewSrc}
            alt="Uploading preview"
            className={`${dimsClass} opacity-70 select-none bg-black`}
            draggable={false}
          />
        ) : (
          <div className={`${dimsClass} bg-black`} aria-hidden="true" />
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <LoadingSpinner size={24} label="Uploading media" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className={rootClasses}
        {...gestureHandlers}
        style={aspectStyle}
        ref={containerRef}
      >
        {isVideo ? (
          <div
            className="relative block w-full select-none bg-black"
            style={aspectStyle}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onLongPress?.();
            }}
          >
            <video
              key={resolvedVideoSrc || "video"}
              ref={videoRef}
              className={dimsClass}
              playsInline
              preload="metadata"
              muted
              controls={false}
              poster={placeholderSrc || media.preview || undefined}
              src={resolvedVideoSrc || undefined}
              onLoadedMetadata={(event) => {
                const vid = event.currentTarget;
                if (vid.videoWidth && vid.videoHeight) {
                  const ratio = vid.videoWidth / vid.videoHeight;
                  if (Number.isFinite(ratio) && ratio > 0) {
                    setInlineAspect(ratio);
                  }
                }
                setVideoReady(true);
              }}
              onLoadedData={() => setVideoReady(true)}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onPlayCapture={() => {
                hasStartedPlaybackRef.current = true;
              }}
              onVolumeChange={(e) => {
                const v = e.currentTarget;
                setIsMuted(!!v.muted);
              }}
            />

            {isVideo && !videoReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                <LoadingSpinner size={22} label="Loading video" />
              </div>
            )}

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
                <SpeakerX size={16} weight="bold" aria-hidden />
              ) : (
                <SpeakerHigh size={16} weight="bold" aria-hidden />
              )}
            </button>

            {/* Center Play overlay when paused (ignore pointer events so clicks hit video/container) */}
            {videoReady && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <button
                  type="button"
                  className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-500/90 text-white shadow-md transition hover:bg-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
                  onClick={handleInlinePlay}
                  aria-label={isPlaying ? "Pause video" : "Play video"}
                >
                  {isPlaying ? (
                    <Pause size={26} weight="fill" aria-hidden />
                  ) : (
                    <Play size={26} weight="fill" aria-hidden />
                  )}
                </button>
              </div>
            )}
          </div>
        ) : (
          <img
            src={displaySrc || resolvedImageSrc || previewSrc}
            alt="attachment"
            className={`${dimsClass} bg-black transition-[filter,opacity,transform] duration-300 ease-out ${
              fullResLoaded
                ? "opacity-100 blur-0 scale-100"
                : "opacity-80 blur-sm scale-[101%]"
            }`}
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
          className="fixed inset-0 z-[100] bg-black flex items-center justify-center p-0 overflow-y-auto"
          onClick={() => setPreviewOpen(false)}
        >
          {/* Fixed header with controls and uploader metadata */}
          <div
            className={`fixed top-0 left-0 right-0 z-[110] flex items-center justify-between gap-3 px-4 py-3 bg-black/50 backdrop-blur-sm transition-opacity duration-200 ${
              modalUiVisible
                ? "opacity-100 pointer-events-auto"
                : "opacity-0 pointer-events-none"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                aria-label="Close preview"
                className="flex items-center justify-center text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                onClick={() => setPreviewOpen(false)}
              >
                <X size={18} weight="bold" aria-hidden />
              </button>
              {overlayUsername ? (
                <div className="flex items-center gap-3 min-w-0">
                  {overlayAvatar ? (
                    <img
                      src={overlayAvatar}
                      alt={`${overlayUsername}'s avatar`}
                      className="h-9 w-9 flex-shrink-0 rounded-full object-cover shadow-sm"
                      draggable={false}
                    />
                  ) : (
                    <div className="h-9 w-9 flex-shrink-0 rounded-full bg-white/15 text-white flex items-center justify-center text-sm font-semibold shadow-sm">
                      {overlayInitial}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-semibold leading-tight text-white truncate">
                      {overlayUsername}
                    </div>
                    {timestampValue ? (
                      <RelativeTime
                        value={timestampValue}
                        className="text-xs text-white/70"
                        withSuffix
                        minUnit="minute"
                        hideBelowMin={false}
                        showJustNowBelowMin
                        justNowThresholdMs={60_000}
                        fallback={absoluteTimestampLabel || ""}
                      />
                    ) : absoluteTimestampLabel ? (
                      <span className="text-xs text-white/70">
                        {absoluteTimestampLabel}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : (
                <span className="text-sm font-semibold text-white">
                  Media preview
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {origin && (
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={downloading}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  {downloading ? (
                    <LoadingSpinner size={14} label="Downloading" />
                  ) : (
                    <DownloadSimple size={16} weight="bold" aria-hidden />
                  )}
                  <span>{downloading ? "Saving…" : "Save"}</span>
                </button>
              )}
            </div>
          </div>

          <div
            className={
              isVideo
                ? modalPortrait
                  ? "relative mx-auto flex h-screen w-screen select-none items-center justify-center"
                  : `relative mx-auto flex ${OVERLAY_MEDIA_WIDTH} ${OVERLAY_MEDIA_HEIGHT} select-none items-center justify-center`
                : `relative mx-auto flex ${OVERLAY_MEDIA_WIDTH} ${OVERLAY_MEDIA_HEIGHT} items-center justify-center`
            }
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button removed; click backdrop to close */}
            {/* If it's a video, always render the video element; use preview as poster */}
            {isVideo ? (
              <div
                className={
                  modalPortrait
                    ? "relative flex h-full w-full select-none items-center justify-center"
                    : "relative flex w-full select-none items-center justify-center"
                }
              >
                {/* Modal video with custom controls */}
                <video
                  key={resolvedVideoSrc || "modal-video"}
                  ref={modalVideoRef}
                  className={
                    modalPortrait
                      ? "h-full w-full object-cover"
                      : `${OVERLAY_MEDIA_WIDTH} ${OVERLAY_MEDIA_HEIGHT} ${OVERLAY_MEDIA_ASPECT} h-auto`
                  }
                  playsInline
                  preload="auto"
                  muted
                  poster={placeholderSrc || media.preview || undefined}
                  src={resolvedVideoSrc || undefined}
                  onClick={(event) => {
                    event.stopPropagation();
                    setModalUiVisible((visible) => !visible);
                  }}
                  onLoadedMetadata={(event) => {
                    const vid = event.currentTarget;
                    if (vid.videoWidth && vid.videoHeight) {
                      setModalPortrait(vid.videoHeight > vid.videoWidth);
                    } else {
                      setModalPortrait(false);
                    }
                    setModalDuration(normalizeDuration(vid.duration));
                    setModalCurrentTime(vid.currentTime || 0);
                    setModalMuted(!!vid.muted);
                    setModalPlaying(!vid.paused);
                    setModalVideoReady(true);
                  }}
                  onLoadedData={(event) => {
                    const vid = event.currentTarget;
                    setModalDuration(normalizeDuration(vid.duration));
                    setModalCurrentTime(vid.currentTime || 0);
                    setModalVideoReady(true);
                  }}
                  onPlay={() => setModalPlaying(true)}
                  onPause={() => setModalPlaying(false)}
                  onVolumeChange={(e) => {
                    const v = e.currentTarget;
                    setModalMuted(!!v.muted);
                  }}
                />

                {modalDuration > 0 && (
                  <div
                    className={`absolute inset-x-0 bottom-0 z-20 px-4 pb-6 pt-20 transition-opacity duration-200 ${
                      modalUiVisible
                        ? "opacity-100 pointer-events-auto"
                        : "opacity-0 pointer-events-none"
                    }`}
                  >
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 top-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
                    <div className="relative z-20 flex flex-col gap-2.5">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          aria-label={modalPlaying ? "Pause" : "Play"}
                          title={modalPlaying ? "Pause" : "Play"}
                          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-red-500 text-white transition hover:bg-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleModalPlayback();
                          }}
                        >
                          {modalPlaying ? (
                            <Pause size={16} weight="fill" aria-hidden />
                          ) : (
                            <Play size={16} weight="fill" aria-hidden />
                          )}
                        </button>
                        <div
                          ref={progressBarRef}
                          className={`relative w-full h-1.5 rounded-full bg-white/25 ${
                            modalDuration ? "cursor-pointer" : "cursor-default"
                          } touch-none select-none ${
                            isScrubbing ? "bg-white/35" : ""
                          } focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white`}
                          role="slider"
                          aria-label="Video progress"
                          aria-valuemin={0}
                          aria-valuemax={Math.max(modalDuration, 0)}
                          aria-valuenow={Math.min(
                            modalCurrentTime,
                            modalDuration || 0
                          )}
                          aria-valuetext={progressLabel}
                          aria-orientation="horizontal"
                          aria-disabled={modalDuration <= 0}
                          tabIndex={modalDuration > 0 ? 0 : -1}
                          onKeyDown={handleProgressKeyDown}
                          onPointerDown={handleProgressPointerDown}
                          onPointerMove={handleProgressPointerMove}
                          onPointerUp={handleProgressPointerUp}
                          onPointerCancel={handleProgressPointerCancel}
                        >
                          <div className="absolute inset-0 rounded-full bg-white/10 pointer-events-none" />
                          <div
                            className="absolute inset-y-0 left-0 rounded-full bg-red-500 pointer-events-none"
                            style={{ width: progressPercentCss }}
                          />
                          <div
                            className="absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full bg-red-500 pointer-events-none"
                            style={{ left: progressPercentCss }}
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <button
                          type="button"
                          aria-label={modalMuted ? "Unmute" : "Mute"}
                          title={modalMuted ? "Unmute" : "Mute"}
                          className="flex items-center justify-center text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
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
                            <SpeakerX size={18} weight="bold" aria-hidden />
                          ) : (
                            <SpeakerHigh size={18} weight="bold" aria-hidden />
                          )}
                        </button>
                        <div className="text-xs font-semibold text-white tabular-nums">
                          {progressLabel}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {isVideo && !modalVideoReady && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                    <LoadingSpinner size={24} label="Preparing video" />
                  </div>
                )}

                {/* Playback controlled through custom overlay controls */}
              </div>
            ) : (
              // Non-video: prefer preview still if available
              <img
                src={
                  fullResLoaded
                    ? resolvedImageSrc || placeholderSrc || previewSrc
                    : displaySrc || placeholderSrc || previewSrc
                }
                alt="attachment"
                className={`${OVERLAY_MEDIA_WIDTH} ${OVERLAY_MEDIA_HEIGHT} ${OVERLAY_MEDIA_ASPECT}`}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
});
MediaMessage.displayName = "MediaMessage";
