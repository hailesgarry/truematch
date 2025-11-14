import React from "react";

const NEUTRAL_BUBBLE_BORDER = "#e2e8f0";
import { useTapGesture } from "../../hooks/useTapGesture";
import type { Message, MessageMedia } from "../../types";
import type { MediaPreviewMeta } from "../common/MediaUpload";
import AudioWave from "../common/AudioWave";
import ReplyPreview from "./ReplyPreview.tsx";
import LinkPreviewCard from "./LinkPreviewCard.tsx";
import { extractLinks } from "../../utils/links";

interface ChatBubbleProps {
  message: Message;
  colors: { bg: string; fg: string };
  openActionsFor: (m: Message) => void;
  openModalFor?: (m: Message, anchor?: HTMLElement | null) => void;
  onQuickReact?: (m: Message) => void;
  tokenizeTextWithGifs: (text: string) => React.ReactNode;
  MediaMessage: React.FC<{
    media: MessageMedia;
    replyMode?: boolean;
    className?: string;
    onLongPress?: () => void;
    onDoubleTap?: (anchor?: HTMLElement | null) => void;
    overlayMeta?: MediaPreviewMeta;
  }>;
  AnimatedMedia: React.FC<{
    url: string;
    large?: boolean;
    mediaSources?: {
      mp4?: string;
      webm?: string;
      gif?: string;
      preview?: string;
    };
  }>;
  currentUsername?: string | null;
  onReplyPreviewClick?: (reply: {
    username: string;
    timestamp: number;
  }) => void;
  onVoiceNoteDuration?: (message: Message, durationMs: number) => void;
  selfAudioAccent?: boolean;
  audioOverrides?: {
    trackColor?: string;
    progressColor?: string;
    buttonBgColor?: string;
    buttonIconColor?: string;
    timeColor?: string;
  };
  // Note: we'll pass through messageId and raw timestamp to the page handlers to improve matching
  utils: {
    isGifUrl: (s: string) => boolean;
    isEmojiOnly: (s?: string) => boolean;
    isVideoUrl: (s: string) => boolean;
    isImageUrl: (s: string) => boolean;
    truncate: (s: string, max?: number) => string;
  };
  resolveMediaOverlayMeta?: (message: Message) => MediaPreviewMeta | undefined;
}

const ChatBubble: React.FC<ChatBubbleProps> = ({
  message: m,
  colors,
  openActionsFor,
  openModalFor,
  onQuickReact: _onQuickReact,
  MediaMessage,
  AnimatedMedia,
  tokenizeTextWithGifs,
  currentUsername,
  onReplyPreviewClick,
  onVoiceNoteDuration,
  selfAudioAccent,
  audioOverrides,
  utils,
  resolveMediaOverlayMeta,
}) => {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const enableGestures = Boolean(openActionsFor);

  const updatePressState = React.useCallback(
    (_next: "idle" | "pressing" | "activated") => {},
    []
  );

  const gestureHintId = React.useId();

  const triggerHaptics = React.useCallback(() => {
    if (
      typeof navigator !== "undefined" &&
      typeof (navigator as { vibrate?: (pattern: number) => void }).vibrate ===
        "function"
    ) {
      try {
        (navigator as { vibrate?: (pattern: number) => void }).vibrate?.(12);
      } catch {
        // ignore haptic errors
      }
    }
  }, []);

  const runLongPressEffects = React.useCallback(() => {
    triggerHaptics();
    updatePressState("activated");
    window.setTimeout(() => updatePressState("idle"), 220);
  }, [triggerHaptics, updatePressState]);

  const activateActions = React.useCallback(
    (evt?: Event | React.SyntheticEvent) => {
      if (evt) {
        const nativeEvent = evt as Event;
        nativeEvent.preventDefault();
        nativeEvent.stopPropagation();
      }
      triggerHaptics();
      updatePressState("activated");
      if (openModalFor) {
        openModalFor(m, containerRef.current);
      } else {
        openActionsFor(m);
      }
      window.setTimeout(() => updatePressState("idle"), 160);
    },
    [m, openActionsFor, openModalFor, triggerHaptics, updatePressState]
  );

  const tapHandlers = useTapGesture({
    onSingleTap: undefined, // single tap does nothing for text bubble (WhatsApp-like)
    onDoubleTap: enableGestures ? () => activateActions() : undefined,
    onLongPress: enableGestures
      ? () => {
          runLongPressEffects();
          openActionsFor(m);
        }
      : undefined,
    doubleTapMs: 250,
    longPressMsTouch: 450,
    longPressMsMouse: 650,
    moveTolerancePx: 10,
    stopPropagation: true,
    preventDefault: false,
  });

  const pressHandlers: React.HTMLAttributes<HTMLElement> = {
    ...tapHandlers,
    tabIndex: 0,
    role: "button",
    "aria-describedby": gestureHintId,
    onKeyDown: (event: React.KeyboardEvent) => {
      const key = event.key;
      const isContext =
        key === "ContextMenu" || (event.shiftKey && key === "F10");
      if (isContext) {
        event.preventDefault();
        runLongPressEffects();
        openActionsFor(m);
      }
    },
  };

  const handleMediaDoubleTap = React.useCallback(
    (anchor?: HTMLElement | null) => {
      if (openModalFor) {
        openModalFor(m, anchor ?? containerRef.current);
      } else {
        openActionsFor(m);
      }
    },
    [m, openActionsFor, openModalFor]
  );

  const pressMotionClass = "";

  const chatMsg = m as any;
  const isDeleted = Boolean((m as any).deleted || (m as any).deletedAt);
  const structuredGif = (m as any).kind === "gif" && (m as any).media;
  const audioMsg = (m as any).kind === "audio" && (m as any).audio;
  const trimmed = (m.text || "").trim();
  const singleGifUrl =
    trimmed &&
    typeof trimmed === "string" &&
    trimmed.match(/\.gif($|\?)/i) &&
    !trimmed.includes(" ");
  const emojiOnly = typeof m.text === "string" && m.text.match(/^\p{Emoji}+$/u);
  const { bg, fg } = colors;
  const neutralBorderEligible = typeof bg === "string" && !/gradient/i.test(bg);
  const bubbleStyle = React.useMemo(() => {
    const style: React.CSSProperties = { background: bg, color: fg };
    if (neutralBorderEligible) {
      style.border = `1px solid ${NEUTRAL_BUBBLE_BORDER}`;
    }
    return style;
  }, [bg, fg, neutralBorderEligible]);

  const replyPreview = chatMsg.replyTo ? (
    <ReplyPreview
      reply={chatMsg.replyTo}
      currentUsername={currentUsername}
      fgColorForBubble={fg}
      onClick={(r) => onReplyPreviewClick?.(r as any)}
      isGifUrl={utils.isGifUrl}
      isEmojiOnly={utils.isEmojiOnly}
      isVideoUrl={utils.isVideoUrl}
      truncate={utils.truncate}
    />
  ) : null;

  // Voice note (audio) message
  if (audioMsg) {
    const audio = (m as any).audio as {
      url: string;
      durationMs?: number;
      uploading?: boolean;
    };
    const accentSelfAudio =
      selfAudioAccent && currentUsername && m.username === currentUsername;
    const overrideTrackColor = audioOverrides?.trackColor;
    const overrideProgressColor = audioOverrides?.progressColor;
    const overrideButtonBgColor = audioOverrides?.buttonBgColor;
    const overrideButtonIconColor = audioOverrides?.buttonIconColor;
    const overrideTimeColor = audioOverrides?.timeColor;
    const trackColor = accentSelfAudio ? "#d896e8" : overrideTrackColor;
    const progressColor = accentSelfAudio ? "#ffffff" : overrideProgressColor;
    const buttonBgColor = accentSelfAudio ? undefined : overrideButtonBgColor;
    const buttonIconColor = accentSelfAudio
      ? "#ffffff"
      : overrideButtonIconColor;
    const timeColor = accentSelfAudio ? "#ffffff" : overrideTimeColor;
    return (
      <div
        className={`w-full py-2 px-2.5 rounded-[20px] break-words transition cursor-pointer select-none ${pressMotionClass}`}
        style={bubbleStyle}
        {...pressHandlers}
        ref={containerRef}
      >
        <span id={gestureHintId} className="sr-only">
          Double tap to open message actions. Long press to copy and open the
          same actions.
        </span>
        {replyPreview}
        <AudioWave
          url={audio.url}
          loading={Boolean(audio.uploading)}
          durationMs={audio.durationMs}
          onDuration={(ms) => onVoiceNoteDuration?.(m, ms)}
          backgroundColor={bg}
          trackColor={trackColor}
          progressColor={progressColor}
          buttonBgColor={buttonBgColor}
          buttonIconColor={buttonIconColor}
          timeColor={timeColor}
        />
      </div>
    );
  }

  // Deleted stays inside a faded bubble
  if (isDeleted) {
    return (
      <div
        className="inline-block max-w-full py-2 px-2.5 rounded-[20px] break-words opacity-60 cursor-default text-left"
        style={bubbleStyle}
      >
        <div className="italic text-sm select-none">
          This message was deleted
        </div>
      </div>
    );
  }

  // Standalone structured GIF (kind: 'gif')
  if (structuredGif) {
    const media = (m as any).media;
    const origin = media.original || media.gif || m.text;
    const mediaEl = (
      <AnimatedMedia
        url={origin}
        large
        mediaSources={{
          mp4: media.mp4,
          webm: media.webm,
          gif: media.gif || origin,
        }}
      />
    );
    if (chatMsg.replyTo) {
      return (
        <div
          className={`w-full py-2 px-2.5 rounded-[20px] break-words transition cursor-pointer select-none ${pressMotionClass}`}
          style={bubbleStyle}
          {...pressHandlers}
          ref={containerRef}
        >
          <span id={gestureHintId} className="sr-only">
            Double tap to open message actions. Long press to copy and open the
            same actions.
          </span>
          {replyPreview}
          {mediaEl}
        </div>
      );
    }
    return (
      <div
        className={`w-full flex flex-col gap-1 cursor-pointer select-none ${pressMotionClass}`}
        {...pressHandlers}
        ref={containerRef}
      >
        <span id={gestureHintId} className="sr-only">
          Double tap to open message actions. Long press to copy and open the
          same actions.
        </span>
        {mediaEl}
      </div>
    );
  }

  // Single GIF URL only: outside bubble unless it's a reply
  if (singleGifUrl) {
    if (chatMsg.replyTo) {
      return (
        <div
          className={`w-full py-2 px-2.5 rounded-[20px] break-words transition cursor-pointer select-none ${pressMotionClass}`}
          style={bubbleStyle}
          {...pressHandlers}
          ref={containerRef}
        >
          <span id={gestureHintId} className="sr-only">
            Double tap to open message actions. Long press to copy and open the
            same actions.
          </span>
          {replyPreview}
          <AnimatedMedia url={trimmed} large />
        </div>
      );
    }
    return (
      <div
        className={`w-full flex flex-col gap-1 cursor-pointer select-none ${pressMotionClass}`}
        {...pressHandlers}
        ref={containerRef}
      >
        <span id={gestureHintId} className="sr-only">
          Double tap to open message actions. Long press to copy and open the
          same actions.
        </span>
        <AnimatedMedia url={trimmed} large />
      </div>
    );
  }

  // Emoji-only: outside bubble unless it's a reply
  if (emojiOnly) {
    if (chatMsg.replyTo) {
      return (
        <div
          className={`w-full py-2 px-2.5 rounded-[20px] break-words transition cursor-pointer select-none ${pressMotionClass}`}
          style={bubbleStyle}
          {...pressHandlers}
          ref={containerRef}
        >
          <span id={gestureHintId} className="sr-only">
            Double tap to open message actions. Long press to copy and open the
            same actions.
          </span>
          {replyPreview}
          <div className="text-4xl sm:text-5xl leading-none">{m.text}</div>
        </div>
      );
    }
    return (
      <div
        className={`w-full flex flex-col gap-1 cursor-pointer select-none ${pressMotionClass}`}
        {...pressHandlers}
        ref={containerRef}
      >
        <span id={gestureHintId} className="sr-only">
          Double tap to open message actions. Long press to copy and open the
          same actions.
        </span>
        <div className="text-4xl sm:text-5xl leading-none">{m.text}</div>
      </div>
    );
  }

  // Structured media (images/videos)
  const structuredMedia =
    (m as any).kind === "media" &&
    (m as any).media &&
    (m as any).media.original;
  const overlayMeta = structuredMedia
    ? resolveMediaOverlayMeta?.(m)
    : undefined;
  if (structuredMedia) {
    const media = (m as any).media;
    if (chatMsg.replyTo) {
      return (
        <div
          className="w-full py-2 px-2.5 rounded-[20px] break-words transition"
          style={bubbleStyle}
        >
          {replyPreview}
          <MediaMessage
            media={media}
            replyMode
            className="w-full"
            onLongPress={() => openActionsFor(m)}
            onDoubleTap={handleMediaDoubleTap}
            overlayMeta={overlayMeta}
          />
        </div>
      );
    }
    return (
      <MediaMessage
        media={media}
        className="w-full"
        onLongPress={() => openActionsFor(m)}
        onDoubleTap={handleMediaDoubleTap}
        overlayMeta={overlayMeta}
      />
    );
  }

  // Default: regular bubble (text / mixed content with inline gifs)
  const textContent = (m.text || "").trim();
  const parsedLinks = React.useMemo(
    () => extractLinks(textContent),
    [textContent]
  );
  const previewTarget = React.useMemo(() => {
    for (const link of parsedLinks) {
      if (
        !utils.isGifUrl(link.url) &&
        !utils.isVideoUrl(link.url) &&
        !utils.isImageUrl(link.url)
      ) {
        return link.url;
      }
    }
    return null;
  }, [parsedLinks, utils]);
  const hasPreview = Boolean(previewTarget);

  const bubbleClasses = [
    hasPreview
      ? "inline-flex flex-col items-stretch gap-2 w-full max-w-full min-w-0"
      : "inline-block max-w-full",
    "py-1.5 px-2.5 rounded-[20px] break-words transition cursor-pointer leading-tight text-left",
  ].join(" ");

  const textClasses = [
    "break-words whitespace-pre-line leading-tight text-sm",
    hasPreview ? "min-w-0" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const textContentNode = (
    <div className={textClasses}>{tokenizeTextWithGifs(textContent)}</div>
  );

  return (
    <div
      className={`${bubbleClasses} select-none ${pressMotionClass}`}
      style={bubbleStyle}
      {...pressHandlers}
      ref={containerRef}
    >
      <span id={gestureHintId} className="sr-only">
        Double tap to open message actions. Long press to copy and open the same
        actions.
      </span>
      {replyPreview}
      {previewTarget ? (
        <>
          <LinkPreviewCard url={previewTarget} className="mt-1" />
          {textContentNode}
        </>
      ) : (
        textContentNode
      )}
    </div>
  );
};

export default ChatBubble;
