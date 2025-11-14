import React from "react";
import { useDrag } from "@use-gesture/react";
import { ArrowBendLeftUp } from "@phosphor-icons/react";

const MOBILE_MAX_WIDTH = 768;
const SWIPE_TRIGGER_THRESHOLD = 72;
const MAX_SWIPE_OFFSET = 112;
const HINT_ACTIVATION_OFFSET = 12;

function isLikelyMobile() {
  if (typeof window === "undefined") return false;
  const width = window.innerWidth || 0;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  return width <= MOBILE_MAX_WIDTH || coarse;
}

type SwipeReplyWrapperProps = {
  children: React.ReactNode;
  onReply: () => void;
  disabled?: boolean;
};

// Enables mobile-only swipe-to-reply interactions and surfaces a reply hint icon.
const SwipeReplyWrapper: React.FC<SwipeReplyWrapperProps> = ({
  children,
  onReply,
  disabled = false,
}) => {
  const [offset, setOffset] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);
  const [replyReady, setReplyReady] = React.useState(false);
  const [hasVibrated, setHasVibrated] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(() => isLikelyMobile());

  const vibrate = React.useCallback(() => {
    if (
      typeof navigator !== "undefined" &&
      typeof (navigator as { vibrate?: (pattern: number) => void }).vibrate ===
        "function"
    ) {
      try {
        (navigator as { vibrate?: (pattern: number) => void }).vibrate?.(12);
      } catch {
        // ignore vibration failures
      }
    }
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      setIsMobile(isLikelyMobile());
    };
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("resize", handler);
    };
  }, []);

  const swipeEnabled = !disabled && isMobile;

  const resetSwipe = React.useCallback(() => {
    setOffset(0);
    setDragging(false);
    setReplyReady(false);
    setHasVibrated(false);
  }, []);

  const bindDrag = useDrag(
    ({ active, movement: [movementX], last, event }) => {
      if (!swipeEnabled) return;
      const pointerType = (event as PointerEvent).pointerType;
      if (pointerType && pointerType !== "touch" && pointerType !== "pen") {
        if (last) resetSwipe();
        return;
      }

      if (!active && !last) return;

      if (movementX <= 0) {
        if (!active || last) {
          resetSwipe();
        } else {
          setOffset(0);
          setReplyReady(false);
        }
        return;
      }

      const clamped = Math.min(movementX, MAX_SWIPE_OFFSET);
      setOffset(clamped);
      setDragging(active);
      const shouldTrigger = clamped >= SWIPE_TRIGGER_THRESHOLD;
      if (shouldTrigger) {
        if (!hasVibrated) {
          vibrate();
          setHasVibrated(true);
        }
      } else if (hasVibrated) {
        setHasVibrated(false);
      }
      setReplyReady(shouldTrigger);

      if (last) {
        if (shouldTrigger) {
          if (!hasVibrated) {
            vibrate();
            setHasVibrated(true);
          }
          onReply();
        }
        resetSwipe();
      }
    },
    {
      axis: "x",
      filterTaps: true,
      pointer: { touch: true },
      preventScroll: true,
      enabled: swipeEnabled,
    }
  );

  React.useEffect(() => {
    if (!swipeEnabled) {
      resetSwipe();
    }
  }, [swipeEnabled, resetSwipe]);

  if (!swipeEnabled) {
    return <>{children}</>;
  }

  const swipeBindings = bindDrag();
  const indicatorOpacity =
    offset > HINT_ACTIVATION_OFFSET
      ? Math.min(1, offset / SWIPE_TRIGGER_THRESHOLD)
      : 0;
  const indicatorScale =
    0.85 + Math.min(0.35, (offset / SWIPE_TRIGGER_THRESHOLD) * 0.35);

  return (
    <div
      className="relative inline-flex w-full overflow-x-hidden"
      style={{ touchAction: "pan-y" }}
      {...swipeBindings}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[2em] top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-gray-100 text-gray-500 shadow-sm transition-transform"
        style={{
          opacity: indicatorOpacity,
          transform: `translateY(-50%) scale(${indicatorScale.toFixed(3)})`,
        }}
      >
        <ArrowBendLeftUp size={18} weight={replyReady ? "bold" : "regular"} />
      </div>
      <div
        className="relative w-full max-w-full"
        style={
          dragging
            ? { transform: `translateX(${offset}px)` }
            : {
                transform: `translateX(${offset}px)`,
                transition: "transform 150ms ease-out",
              }
        }
      >
        {children}
      </div>
    </div>
  );
};

export default SwipeReplyWrapper;
