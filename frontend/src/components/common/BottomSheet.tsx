import React, {
  useEffect,
  useRef,
  useCallback,
  useLayoutEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  ariaDescription?: string;
  children: React.ReactNode;
  closeOnOverlayClick?: boolean;
  closeOnEsc?: boolean;
  draggable?: boolean;
  height?: string | number; // explicit height override
  maxHeight?: string | number; // default 85vh
  initialFocusRef?: React.RefObject<HTMLElement>;
  className?: string;
  style?: React.CSSProperties;
  /** Optional z-index override for the sheet overlay container */
  zIndex?: number;
}

const KEY_TAB = "Tab";
const KEY_ESC = "Escape";

const BottomSheet: React.FC<BottomSheetProps> = ({
  isOpen,
  onClose,
  title,
  ariaDescription,
  children,
  closeOnOverlayClick = true,
  closeOnEsc = true,
  draggable = true,
  height,
  maxHeight = "85vh",
  initialFocusRef,
  className,
  style,
  zIndex,
}) => {
  const sheetRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);

  // Drag state
  const dragStartY = useRef<number | null>(null);
  const lastY = useRef<number>(0);
  const hasDragged = useRef(false);

  // Only render portal after client mount
  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock scroll on body when open
  useEffect(() => {
    if (isOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [isOpen]);

  // Keep reference to element that had focus (restore on close)
  useEffect(() => {
    if (isOpen) {
      previouslyFocused.current = document.activeElement as HTMLElement;
    } else if (!isOpen && previouslyFocused.current) {
      previouslyFocused.current.focus({ preventScroll: true });
    }
  }, [isOpen]);

  // Focus handling
  useLayoutEffect(() => {
    if (isOpen && sheetRef.current) {
      const target =
        initialFocusRef?.current ||
        sheetRef.current.querySelector<HTMLElement>(
          "[data-autofocus], button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
        );
      target?.focus();
    }
  }, [isOpen, initialFocusRef]);

  // Basic focus trap
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen || !sheetRef.current) return;

      if (closeOnEsc && e.key === KEY_ESC) {
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === KEY_TAB) {
        const focusables = Array.from(
          sheetRef.current.querySelectorAll<HTMLElement>(
            "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
          )
        ).filter(
          (el) =>
            !el.hasAttribute("disabled") && !el.getAttribute("aria-hidden")
        );
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement;
        if (e.shiftKey) {
          if (active === first || !sheetRef.current.contains(active)) {
            last.focus();
            e.preventDefault();
          }
        } else {
          if (active === last) {
            first.focus();
            e.preventDefault();
          }
        }
      }
    },
    [isOpen, onClose, closeOnEsc]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown, true);
      return () => document.removeEventListener("keydown", handleKeyDown, true);
    }
  }, [isOpen, handleKeyDown]);

  // Overlay click
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (!closeOnOverlayClick) return;
    if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
      onClose();
    }
  };

  // Drag handlers (touch + mouse)
  const onDragStart = (clientY: number) => {
    dragStartY.current = clientY;
    lastY.current = 0;
    hasDragged.current = false;
    if (sheetRef.current) {
      sheetRef.current.style.transition = "none";
    }
  };

  const onDragMove = (clientY: number) => {
    if (dragStartY.current == null) return;
    const delta = clientY - dragStartY.current;
    if (delta < 0) return; // don't drag upward
    if (delta > 4) hasDragged.current = true;
    lastY.current = delta;
    if (sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${delta}px)`;
      sheetRef.current.style.opacity = `${Math.max(0.4, 1 - delta / 600)}`;
    }
  };

  const onDragEnd = () => {
    if (dragStartY.current == null) return;
    const delta = lastY.current;
    dragStartY.current = null;

    if (!sheetRef.current) return;

    // threshold: 120px or > 35% of height
    const heightPx = sheetRef.current.getBoundingClientRect().height;
    const threshold = Math.min(180, heightPx * 0.35);

    sheetRef.current.style.transition =
      "transform 220ms ease, opacity 220ms ease";

    if (delta > threshold) {
      sheetRef.current.style.transform = `translateY(${heightPx}px)`;
      sheetRef.current.style.opacity = "0";
      // Close after animation
      setTimeout(() => onClose(), 210);
    } else {
      sheetRef.current.style.transform = "";
      sheetRef.current.style.opacity = "";
    }
  };

  // Attach pointer / touch events
  useEffect(() => {
    if (!isOpen || !draggable) return;
    const handle =
      sheetRef.current?.querySelector<HTMLDivElement>("[data-drag-handle]");
    if (!handle) return;

    const touchStart = (e: TouchEvent) => onDragStart(e.touches[0].clientY);
    const touchMove = (e: TouchEvent) => onDragMove(e.touches[0].clientY);
    const touchEnd = () => onDragEnd();

    const mouseStart = (e: MouseEvent) => {
      e.preventDefault();
      onDragStart(e.clientY);
      document.addEventListener("mousemove", mouseMove);
      document.addEventListener("mouseup", mouseUp);
    };
    const mouseMove = (e: MouseEvent) => onDragMove(e.clientY);
    const mouseUp = () => {
      onDragEnd();
      document.removeEventListener("mousemove", mouseMove);
      document.removeEventListener("mouseup", mouseUp);
    };

    handle.addEventListener("touchstart", touchStart, { passive: true });
    handle.addEventListener("touchmove", touchMove, { passive: false });
    handle.addEventListener("touchend", touchEnd);
    handle.addEventListener("mousedown", mouseStart);

    return () => {
      handle.removeEventListener("touchstart", touchStart);
      handle.removeEventListener("touchmove", touchMove);
      handle.removeEventListener("touchend", touchEnd);
      handle.removeEventListener("mousedown", mouseStart);
      document.removeEventListener("mousemove", mouseMove);
      document.removeEventListener("mouseup", mouseUp);
    };
  }, [isOpen, draggable]);

  if (!mounted) return null;
  if (!isOpen) return null;

  const titleId = title
    ? "bottomsheet-title-" + Math.random().toString(36).slice(2)
    : undefined;
  const descId = ariaDescription
    ? "bottomsheet-desc-" + Math.random().toString(36).slice(2)
    : undefined;

  return createPortal(
    <div
      className="fixed inset-0 flex flex-col justify-end"
      aria-hidden={!isOpen}
      onMouseDown={handleOverlayClick}
      role="presentation"
      style={{ zIndex: zIndex ?? 120 }}
    >
      {/* Overlay */}
      <div
        className={clsx(
          "absolute inset-0 bg-black/50 backdrop-blur-[1px] opacity-100 transition-opacity"
        )}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        className={clsx(
          "relative w-full bg-white rounded-t-2xl shadow-lg pt-2",
          "animate-[bottomsheet-in_0.28s_ease] flex flex-col",
          "focus:outline-none",
          className
        )}
        style={{
          maxHeight,
          height,
          ...style,
          // ensure transform resets when open
          willChange: "transform",
        }}
        onMouseDown={(e) => {
          // Prevent overlay handler when clicking inside
          if (sheetRef.current && sheetRef.current.contains(e.target as Node)) {
            e.stopPropagation();
          }
        }}
      >
        {/* Drag handle */}
        <div
          data-drag-handle
          className={clsx(
            "mx-auto mb-2 h-1.5 w-10 rounded-full bg-gray-300",
            draggable ? "cursor-grab active:cursor-grabbing" : ""
          )}
          aria-hidden="true"
        />

        {title && (
          <div className="px-4 pb-3 flex items-start justify-center gap-2">
            <h2
              id={titleId}
              className="text-base font-semibold text-gray-900 leading-none mt-0.5 text-center w-full"
            >
              {title}
            </h2>
          </div>
        )}

        {ariaDescription && (
          <p id={descId} className="sr-only">
            {ariaDescription}
          </p>
        )}

        {/* Scroll container */}
        <div
          ref={contentRef}
          className={clsx(
            "px-4 pb-6 overflow-y-auto",
            "flex-1",
            // Safe area support for iOS notch
            "pt-0",
            "scrollbar-thin scrollbar-thumb-rounded-md scrollbar-thumb-gray-300"
          )}
          style={{
            WebkitOverflowScrolling: "touch",
            overscrollBehavior: "contain",
          }}
        >
          {children}
          <div style={{ paddingBottom: "env(safe-area-inset-bottom)" }} />
        </div>
      </div>

      {/* Tailwind keyframes (if not already defined globally) could be added in your CSS:
          @keyframes bottomsheet-in { from { transform: translateY(20px); opacity:0 } to { transform:translateY(0); opacity:1 } }
      */}
    </div>,
    document.body
  );
};

export default BottomSheet;
