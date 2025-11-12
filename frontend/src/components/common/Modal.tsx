import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  ariaDescription?: string;
  children: React.ReactNode;
  closeOnOverlayClick?: boolean;
  closeOnEsc?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement>;
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "full";
  centered?: boolean; // center heading and content text
  className?: string;
  style?: React.CSSProperties;
  hideTitle?: boolean;
}

const KEY_TAB = "Tab";
const KEY_ESC = "Escape";

const sizeClasses: Record<NonNullable<ModalProps["size"]>, string> = {
  xs: "max-w-xs",
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
  full: "max-w-[min(92vw,900px)]",
};

const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  ariaDescription,
  children,
  closeOnOverlayClick = true,
  closeOnEsc = true,
  initialFocusRef,
  size = "md",
  centered = false,
  className,
  style,
  hideTitle = false,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);

  // mount
  useEffect(() => setMounted(true), []);

  // Scroll lock
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  // Track and restore focus
  useEffect(() => {
    if (isOpen) {
      previouslyFocused.current = document.activeElement as HTMLElement;
    } else if (!isOpen && previouslyFocused.current) {
      previouslyFocused.current.focus({ preventScroll: true });
    }
  }, [isOpen]);

  // Move focus into dialog
  useLayoutEffect(() => {
    if (!isOpen || !dialogRef.current) return;
    const target =
      initialFocusRef?.current ||
      dialogRef.current.querySelector<HTMLElement>(
        "[data-autofocus], button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
      );
    target?.focus();
  }, [isOpen, initialFocusRef]);

  // Focus trap + ESC
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen || !dialogRef.current) return;

      if (closeOnEsc && e.key === KEY_ESC) {
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === KEY_TAB) {
        const container = dialogRef.current;
        const focusables = Array.from(
          container.querySelectorAll<HTMLElement>(
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
          if (active === first || !container.contains(active)) {
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
    if (!isOpen) return;
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, handleKeyDown]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (!closeOnOverlayClick) return;
    if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
      onClose();
    }
  };

  if (!mounted || !isOpen) return null;

  const titleId =
    title && !hideTitle
      ? "modal-title-" + Math.random().toString(36).slice(2)
      : undefined;
  const descId = ariaDescription
    ? "modal-desc-" + Math.random().toString(36).slice(2)
    : undefined;

  return createPortal(
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center"
      onMouseDown={handleOverlayClick}
      aria-hidden={!isOpen}
      role="presentation"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        className={clsx(
          "relative w-full mx-4 bg-white rounded-xl shadow-xl",
          "animate-[modal-in_0.22s_ease]",
          sizeClasses[size],
          className
        )}
        style={{
          ...style,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
        }}
        onMouseDown={(e) => {
          if (
            dialogRef.current &&
            dialogRef.current.contains(e.target as Node)
          ) {
            e.stopPropagation();
          }
        }}
      >
        {title && !hideTitle && (
          <div
            className={clsx(
              "px-5 pt-4 pb-3 border-b",
              centered && "text-center"
            )}
          >
            <h2
              id={titleId}
              className={clsx(
                "text-base font-semibold text-gray-900",
                centered && "text-center"
              )}
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

        <div
          className={clsx(
            "px-5 py-4 overflow-y-auto",
            centered && "text-center",
            "scrollbar-thin scrollbar-thumb-rounded-md scrollbar-thumb-gray-300"
          )}
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {children}
          <div style={{ paddingBottom: "env(safe-area-inset-bottom)" }} />
        </div>
      </div>

      {/* Optional keyframes (if not defined globally):
        @keyframes modal-in { from { transform: translateY(6px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
      */}
    </div>,
    document.body
  );
};

export default Modal;
