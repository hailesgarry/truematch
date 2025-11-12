import React from "react";

type FullscreenOverlayProps = {
  isOpen: boolean;
  onClose: () => void;
  // Optional: close when clicking the shaded backdrop
  closeOnBackdrop?: boolean;
  // Optional: show or hide the backdrop entirely
  showBackdrop?: boolean;
  // Optional: override root overlay classes (e.g., z-index)
  overlayClassName?: string;
  // Optional: additional classes for container
  className?: string;
  children: React.ReactNode;
};

/**
 * FullscreenOverlay
 * A simple, reusable full-screen overlay with a light backdrop.
 * Renders children when open, blocks page scroll, and traps clicks.
 */
const FullscreenOverlay: React.FC<FullscreenOverlayProps> = ({
  isOpen,
  onClose,
  closeOnBackdrop = true,
  showBackdrop = true,
  overlayClassName,
  className = "",
  children,
}) => {
  React.useEffect(() => {
    if (!isOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 flex items-stretch justify-center ${
        overlayClassName ?? "z-[100]"
      }`}
      aria-modal="true"
      role="dialog"
    >
      {/* Scroll + scrollbar styling (scoped to this overlay) */}
      <style>{`
        .tm-overlay-scroll {
          /* Modern, mobile-friendly scrolling */
          -webkit-overflow-scrolling: touch; /* iOS momentum */
          overscroll-behavior-y: contain;   /* prevent scroll chaining */
          overscroll-behavior-x: none;
          scroll-behavior: smooth;          /* smooth programmatic scroll */
        }
        /* Hide scrollbars cross-browser while preserving scrollability */
        .tm-overlay-scroll { scrollbar-width: none; -ms-overflow-style: none; }
        .tm-overlay-scroll::-webkit-scrollbar { width: 0; height: 0; }
      `}</style>
      {/* Backdrop */}
      {showBackdrop && (
        <div
          className="absolute inset-0 bg-black/30"
          onClick={closeOnBackdrop ? onClose : undefined}
        />
      )}

      {/* Content (scrollable) */}
      <div
        className={
          "tm-overlay-scroll relative z-10 w-full h-full bg-white overflow-y-auto overscroll-y-contain " +
          className
        }
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
};

export default FullscreenOverlay;
