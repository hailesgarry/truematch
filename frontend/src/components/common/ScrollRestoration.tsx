import React from "react";

type ScrollAxis = "vertical" | "horizontal";

export type ScrollRestorationHandle = {
  save: () => void;
  restore: () => void;
  reset: () => void;
};

export interface ScrollRestorationProps {
  targetRef: React.RefObject<HTMLElement | null>;
  storageKey: string;
  axis?: ScrollAxis;
  /**
   * Debounce duration (ms) before persisting the latest scroll position.
   * Defaults to 100ms to avoid hammering sessionStorage.
   */
  debounceMs?: number;
  /**
   * If true, skip restoring on mount (caller can invoke restore manually).
   */
  manualRestore?: boolean;
  /**
   * Optional callback invoked after a restore attempt, receives the value applied (or 0).
   */
  onRestore?: (value: number) => void;
}

const ScrollRestoration = React.forwardRef<
  ScrollRestorationHandle,
  ScrollRestorationProps
>(
  (
    {
      targetRef,
      storageKey,
      axis = "vertical",
      debounceMs = 100,
      manualRestore = false,
      onRestore,
    },
    ref
  ) => {
    const frameRef = React.useRef<number | null>(null);
    const debounceRef = React.useRef<number | null>(null);
    const pendingValueRef = React.useRef<number>(0);

    const isVertical = axis === "vertical";

    const applyScroll = React.useCallback(
      (value: number) => {
        const node = targetRef.current;
        if (!node) return;
        if (isVertical) {
          node.scrollTop = value;
        } else {
          node.scrollLeft = value;
        }
      },
      [isVertical, targetRef]
    );

    const readScroll = React.useCallback(() => {
      const node = targetRef.current;
      if (!node) return 0;
      return isVertical ? node.scrollTop : node.scrollLeft;
    }, [isVertical, targetRef]);

    const save = React.useCallback(() => {
      const value = readScroll();
      pendingValueRef.current = value;
      try {
        sessionStorage.setItem(storageKey, String(value));
      } catch {
        /* ignore */
      }
    }, [readScroll, storageKey]);

    const restore = React.useCallback(() => {
      let stored = 0;
      try {
        const raw = sessionStorage.getItem(storageKey);
        if (raw != null) stored = Number(raw) || 0;
      } catch {
        stored = 0;
      }
      const node = targetRef.current;
      if (!node) {
        onRestore?.(0);
        return;
      }

      const apply = () => {
        applyScroll(stored);
        onRestore?.(stored);
      };

      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(apply);
    }, [applyScroll, onRestore, storageKey, targetRef]);

    const reset = React.useCallback(() => {
      pendingValueRef.current = 0;
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
    }, [storageKey]);

    React.useImperativeHandle(
      ref,
      () => ({
        save,
        restore,
        reset,
      }),
      [restore, save, reset]
    );

    React.useEffect(() => {
      const node = targetRef.current;
      if (!node) return;

      if (!manualRestore) {
        restore();
      }

      const handleScroll = () => {
        if (debounceRef.current != null) {
          clearTimeout(debounceRef.current);
        }
        debounceRef.current = window.setTimeout(save, debounceMs);
      };

      node.addEventListener("scroll", handleScroll, { passive: true });
      return () => {
        node.removeEventListener("scroll", handleScroll);
        if (debounceRef.current != null) {
          clearTimeout(debounceRef.current);
          debounceRef.current = null;
        }
      };
    }, [debounceMs, manualRestore, restore, save, targetRef]);

    React.useEffect(
      () => () => {
        if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
        if (debounceRef.current != null) {
          clearTimeout(debounceRef.current);
          debounceRef.current = null;
        }
      },
      []
    );

    return null;
  }
);

ScrollRestoration.displayName = "ScrollRestoration";

export default ScrollRestoration;
