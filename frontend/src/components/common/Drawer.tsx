import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

type DrawerProps = {
  // New API (used by ReactionDrawer)
  open?: boolean;
  side?: "right" | "left";
  width?: number | string; // default 360

  // Legacy API (used by AppShell)
  isOpen?: boolean; // alias for open
  position?: "left" | "right" | "bottom"; // alias for side (+ bottom)
  height?: number | string; // used when position === 'bottom'

  // Common
  onClose: () => void;
  title?: React.ReactNode;
  showCloseButton?: boolean; // NEW: optionally hide the header close button
  className?: string;
  children: React.ReactNode;
  closeOnOverlayClick?: boolean;
  closeOnEsc?: boolean;
};

const Drawer: React.FC<DrawerProps> = (props) => {
  const {
    open,
    isOpen,
    onClose,
    title,
    showCloseButton = true,
    side,
    position,
    width = 360,
    height,
    className,
    children,
    closeOnOverlayClick = true,
    closeOnEsc = true,
  } = props;

  const effectiveOpen = Boolean(open ?? isOpen);
  const effectiveSide = (position as any) || side || "right"; // may be 'bottom'
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!effectiveOpen || !closeOnEsc) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [effectiveOpen, closeOnEsc, onClose]);

  useEffect(() => {
    if (!effectiveOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [effectiveOpen]);

  if (!mounted || !effectiveOpen) return null;

  const titleId = title
    ? `drawer-title-${Math.random().toString(36).slice(2)}`
    : undefined;

  return createPortal(
    <div
      className="fixed inset-0 z-[60]"
      role="presentation"
      aria-hidden={!effectiveOpen}
      onMouseDown={(e) => {
        if (!closeOnOverlayClick) return;
        if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
          onClose();
        }
      }}
    >
      {/* overlay */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" />

      {/* panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={clsx(
          "absolute bg-white shadow-xl flex flex-col focus:outline-none",
          effectiveSide === "bottom"
            ? "left-0 right-0 bottom-0"
            : "top-0 h-full",
          effectiveSide === "right"
            ? "right-0"
            : effectiveSide === "left"
            ? "left-0"
            : "",
          "animate-[drawer-in_0.22s_ease]",
          className
        )}
        style={{
          width: effectiveSide === "bottom" ? undefined : width,
          height: effectiveSide === "bottom" ? height || "55vh" : undefined,
        }}
        onMouseDown={(e) => {
          // prevent bubbling to overlay
          e.stopPropagation();
        }}
      >
        {title && (
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h2 id={titleId} className="text-sm font-semibold text-gray-900">
              {title}
            </h2>
            {showCloseButton && (
              <button
                type="button"
                className="p-1 rounded-md hover:bg-gray-100"
                aria-label="Close"
                onClick={onClose}
              >
                <span aria-hidden>✕</span>
              </button>
            )}
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {children}
          <div style={{ paddingBottom: "env(safe-area-inset-bottom)" }} />
        </div>
      </div>

      {/* keyframes (tailwind not required; declared globally at runtime) */}
      <style>{`
        @keyframes drawer-in {
          from {
            opacity: 0;
            transform: ${
              effectiveSide === "bottom"
                ? "translateY(20px)"
                : effectiveSide === "right"
                ? "translateX(20px)"
                : "translateX(-20px)"
            };
          }
          to { opacity: 1; transform: translate(0,0); }
        }
      `}</style>
    </div>,
    document.body
  );
};

export default Drawer;
