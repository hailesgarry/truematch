import React from "react";

type Options = {
  onSingleTap?: (e: React.SyntheticEvent) => void;
  onDoubleTap?: (e: React.SyntheticEvent) => void;
  onLongPress?: (e: React.SyntheticEvent) => void;
  longPressMsTouch?: number;
  longPressMsMouse?: number;
  doubleTapMs?: number;
  moveTolerancePx?: number;
  stopPropagation?: boolean;
  preventDefault?: boolean;
};

/**
 * Unified tap/long-press/double-tap detector using Pointer Events.
 * - Single tap fires after `doubleTapMs` unless a second tap arrives
 * - Double tap cancels pending single tap and fires immediately
 * - Long press fires after threshold while pointer is down and stationary
 */
export function useTapGesture(options: Options) {
  const {
    onSingleTap,
    onDoubleTap,
    onLongPress,
    longPressMsTouch = 450,
    longPressMsMouse = 650,
    doubleTapMs = 250,
    moveTolerancePx = 10,
    stopPropagation = true,
    preventDefault = false,
  } = options;

  const startX = React.useRef(0);
  const startY = React.useRef(0);
  const pointerDown = React.useRef(false);
  const moved = React.useRef(false);
  const longPressTimer = React.useRef<number | null>(null);
  const singleTapTimer = React.useRef<number | null>(null);
  const lastTapTime = React.useRef(0);
  const longPressFired = React.useRef(false);
  const pointerTypeRef = React.useRef<"mouse" | "touch" | "pen" | null>(null);

  const clearLongPress = React.useCallback(() => {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const clearSingleTap = React.useCallback(() => {
    if (singleTapTimer.current != null) {
      window.clearTimeout(singleTapTimer.current);
      singleTapTimer.current = null;
    }
  }, []);

  const cancelAll = React.useCallback(() => {
    clearLongPress();
    clearSingleTap();
    pointerDown.current = false;
    moved.current = false;
    longPressFired.current = false;
  }, [clearLongPress, clearSingleTap]);

  const maybeStop = (e: React.SyntheticEvent) => {
    if (preventDefault) e.preventDefault();
    if (stopPropagation) e.stopPropagation();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    maybeStop(e);
    pointerDown.current = true;
    moved.current = false;
    longPressFired.current = false;

    startX.current = e.clientX;
    startY.current = e.clientY;

    // determine thresholds by pointer type
    const pt = e.pointerType as "mouse" | "touch" | "pen" | undefined;
    pointerTypeRef.current = (pt || "mouse") as any;
    const longMs = pt === "mouse" ? longPressMsMouse : longPressMsTouch;

    clearLongPress();
    if (onLongPress) {
      longPressTimer.current = window.setTimeout(() => {
        if (pointerDown.current && !moved.current) {
          longPressFired.current = true;
          onLongPress?.(e);
        }
      }, longMs);
    }

    // capture to receive move/up even if cursor leaves
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {}
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointerDown.current) return;
    const dx = Math.abs(e.clientX - startX.current);
    const dy = Math.abs(e.clientY - startY.current);
    if (dx > moveTolerancePx || dy > moveTolerancePx) {
      moved.current = true;
      clearLongPress();
    }
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    maybeStop(e);
    cancelAll();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    maybeStop(e);
    const now = Date.now();
    const wasLong = longPressFired.current;
    const wasMoved = moved.current;
    clearLongPress();
    pointerDown.current = false;

    if (wasLong || wasMoved) {
      // ignore taps after long press or move
      longPressFired.current = false;
      return;
    }

    // double vs single tap
    if (onDoubleTap) {
      if (lastTapTime.current && now - lastTapTime.current <= doubleTapMs) {
        // double tap: cancel pending single and fire
        clearSingleTap();
        lastTapTime.current = 0;
        onDoubleTap(e);
        return;
      }
      lastTapTime.current = now;
      // defer single tap to allow for second tap
      if (onSingleTap) {
        clearSingleTap();
        singleTapTimer.current = window.setTimeout(() => {
          lastTapTime.current = 0;
          onSingleTap(e);
        }, doubleTapMs);
      } else {
        // no single tap action, just clear timestamp later
        clearSingleTap();
        singleTapTimer.current = window.setTimeout(() => {
          lastTapTime.current = 0;
          clearSingleTap();
        }, doubleTapMs);
      }
    } else if (onSingleTap) {
      // no double tap: fire immediately
      onSingleTap(e);
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    maybeStop(e as any);
    e.preventDefault();
    onLongPress?.(e as any);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    // block native dblclick to avoid duplicate
    maybeStop(e as any);
    e.preventDefault();
    if (onDoubleTap) {
      clearSingleTap();
      lastTapTime.current = 0;
      onDoubleTap(e as any);
    }
  };

  React.useEffect(() => () => cancelAll(), [cancelAll]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onContextMenu,
    onDoubleClick,
  } as React.HTMLAttributes<HTMLElement>;
}
