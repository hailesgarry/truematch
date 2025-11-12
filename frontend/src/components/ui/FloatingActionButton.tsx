import React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

type FloatingActionButtonProps = {
  onClick: () => void;
  show?: boolean;
  ariaLabel: string;
  className?: string;
  children?: React.ReactNode; // icon or any content
  title?: string;
};

/**
 * FloatingActionButton
 * - Reusable FAB that floats bottom-right by default
 * - Pass `show` to control visibility (animates in/out)
 * - Provide an icon/content via children
 */
const FloatingActionButton: React.FC<FloatingActionButtonProps> = ({
  onClick,
  show = true,
  ariaLabel,
  className = "",
  children,
  title,
}) => {
  const prefersReducedMotion = useReducedMotion();

  const baseClasses =
    // Positioning: bottom-right; raise above headers/sheets; account for composer
    `fixed right-4 bottom-28 sm:bottom-24 z-50 ` +
    // Base styles
    `rounded-full bg-primary-gradient text-white shadow-lg ` +
    `focus:outline-none ` +
    `p-2.5 ` +
    (className ? ` ${className}` : "");

  const variants = prefersReducedMotion
    ? {
        hidden: { opacity: 0 },
        visible: { opacity: 1 },
      }
    : {
        hidden: { opacity: 0, y: 12, scale: 0.96 },
        visible: { opacity: 1, y: 0, scale: 1 },
      };

  const transition = prefersReducedMotion
    ? ({ type: "tween", duration: 0.16 } as const)
    : ({ type: "spring", stiffness: 480, damping: 34, mass: 0.6 } as const);

  return (
    <AnimatePresence initial={false} mode="popLayout">
      {show && (
        <motion.button
          type="button"
          aria-label={ariaLabel}
          title={title || ariaLabel}
          onClick={onClick}
          className={baseClasses}
          initial="hidden"
          animate="visible"
          exit="hidden"
          variants={variants}
          transition={transition}
        >
          {children}
        </motion.button>
      )}
    </AnimatePresence>
  );
};

export default FloatingActionButton;
