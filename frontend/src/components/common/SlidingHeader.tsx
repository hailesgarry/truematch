import React from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";

type SlidingHeaderProps = {
  scrollRef?:
    | React.RefObject<HTMLElement | HTMLDivElement | null>
    | React.MutableRefObject<HTMLElement | HTMLDivElement | null>
    | null;
  className?: string; // classes for the outer fixed header
  innerClassName?: string; // classes for inner content wrapper
  deltaThreshold?: number; // minimal delta before toggling, to avoid jitter
  alwaysShowAtTop?: number; // px near top where header is forced visible
  anchor?: "top" | "bottom"; // where the bar is fixed; default top
  hideOnScroll?: "up" | "down"; // when to hide based on scroll direction; default up (preserves ChatPage behavior)
  cooldownMs?: number; // minimum ms between visibility toggles (prevents jitter)
  reduceMotion?: boolean; // force reduced motion; if undefined, honors prefers-reduced-motion
  onVisibilityChange?: (hidden: boolean) => void; // callback when hidden state changes
  setCssVarName?: string; // if provided, set a CSS variable with measured height on :root
  showShadowAt?: number; // add a subtle shadow once scrollTop past this px
  outerStyle?: React.CSSProperties; // optional inline style for outer wrapper
  innerStyle?: React.CSSProperties; // optional inline style for inner wrapper
  role?: React.AriaRole; // accessibility role for the container
  ariaLabel?: string; // accessibility label for the container
  springConfig?: Partial<{
    stiffness: number;
    damping: number;
    mass: number;
    restDelta: number;
    restSpeed: number;
  }>; // override spring options
  children: React.ReactNode;
};

export type SlidingHeaderHandle = {
  show: () => void;
  hide: () => void;
  toggle: () => void;
  measure: () => number; // returns current measured height
};

const SlidingHeader = React.forwardRef<SlidingHeaderHandle, SlidingHeaderProps>(
  (
    {
      scrollRef,
      className,
      innerClassName,
      deltaThreshold = 12,
      alwaysShowAtTop = 4,
      anchor = "top",
      hideOnScroll = "up",
      cooldownMs = 120,
      reduceMotion,
      onVisibilityChange,
      setCssVarName,
      showShadowAt,
      outerStyle,
      innerStyle,
      role,
      ariaLabel,
      springConfig,
      children,
    },
    ref
  ) => {
    const [hidden, setHidden] = React.useState(false);
    const lastScrollTopRef = React.useRef(0);
    const lastToggleAtRef = React.useRef<number>(0);
    const [scrolled, setScrolled] = React.useState(false);
    // Motion values for smooth Y translation
    const y = useMotionValue(0);
    const springOpts = React.useMemo(
      () => ({
        stiffness: 520,
        damping: 38,
        mass: 0.6,
        ...(springConfig || {}),
      }),
      [springConfig]
    );
    // Respect prefers-reduced-motion by default
    const prefersReduced = React.useMemo(() => {
      if (typeof window === "undefined" || !("matchMedia" in window))
        return false;
      try {
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      } catch {
        return false;
      }
    }, []);
    const effectiveReduceMotion = reduceMotion ?? prefersReduced;
    const ySpring = useSpring(y, springOpts);
    const sourceY = effectiveReduceMotion ? y : ySpring;
    const translateY = useTransform(sourceY, (val) => `translateY(${val}px)`);
    const headerRef = React.useRef<HTMLDivElement | null>(null);
    const [height, setHeight] = React.useState(0);

    // Measure header height and update on resize
    React.useEffect(() => {
      const measure = () => {
        const h = headerRef.current?.offsetHeight || 0;
        setHeight(h);
      };
      measure();
      const ro = new ResizeObserver(measure);
      if (headerRef.current) ro.observe(headerRef.current);
      window.addEventListener("resize", measure);
      return () => {
        ro.disconnect();
        window.removeEventListener("resize", measure);
      };
    }, []);

    React.useEffect(() => {
      const targetEl = scrollRef?.current || null;
      const useWindow = !targetEl;

      const getScrollTop = (ev?: Event) => {
        if (!useWindow) return (targetEl as HTMLElement).scrollTop;
        if (ev && ev.target && ev.target !== document && ev.target !== window) {
          const t = ev.target as HTMLElement;
          if (typeof (t as any).scrollTop === "number")
            return (t as any).scrollTop;
        }
        return window.scrollY || document.documentElement.scrollTop || 0;
      };

      let rafId: number | null = null;
      const handleScrollLogic = (st: number) => {
        if (st <= alwaysShowAtTop) {
          setHidden(false);
          // snap to shown
          requestAnimationFrame(() => {
            y.set(0);
          });
          lastScrollTopRef.current = st;
          if (showShadowAt != null) setScrolled(false);
          return;
        }
        const delta = st - lastScrollTopRef.current;
        if (Math.abs(delta) < deltaThreshold) return;
        // Determine hide condition based on desired scroll direction
        const hide = hideOnScroll === "up" ? delta < 0 : delta > 0;
        if (hide !== hidden) {
          const now = Date.now();
          if (now - lastToggleAtRef.current >= cooldownMs) {
            lastToggleAtRef.current = now;
            setHidden(hide);
          }
        }
        lastScrollTopRef.current = st;
        if (showShadowAt != null) setScrolled(st > showShadowAt);
      };

      const onScroll = (ev?: Event) => {
        const st = getScrollTop(ev);
        if (rafId != null) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => handleScrollLogic(st));
      };

      if (useWindow) {
        window.addEventListener("scroll", onScroll as EventListener, {
          passive: true,
        });
        // capture scrolls on nested containers too
        document.addEventListener("scroll", onScroll as EventListener, {
          passive: true,
          capture: true,
        });
        return () => {
          window.removeEventListener("scroll", onScroll as EventListener);
          document.removeEventListener(
            "scroll",
            onScroll as EventListener,
            true as any
          );
          if (rafId != null) cancelAnimationFrame(rafId);
        };
      } else {
        targetEl!.addEventListener(
          "scroll",
          onScroll as EventListener,
          { passive: true } as any
        );
        return () => {
          targetEl!.removeEventListener("scroll", onScroll as EventListener);
          if (rafId != null) cancelAnimationFrame(rafId);
        };
      }
    }, [
      scrollRef,
      deltaThreshold,
      alwaysShowAtTop,
      hideOnScroll,
      cooldownMs,
      hidden,
      showShadowAt,
    ]);

    // Animate to hidden position (positive or negative measured height) or 0 depending on anchor/hide direction
    React.useEffect(() => {
      const magnitude = Math.max(height, 0);
      let sign = 0;
      if (anchor === "top") {
        sign = hideOnScroll === "up" ? -1 : 1;
      } else {
        // anchor bottom
        sign = hideOnScroll === "up" ? -1 : 1;
      }
      const target = hidden ? sign * magnitude : 0;
      y.stop();
      y.set(target);
    }, [hidden, y, height, anchor, hideOnScroll]);

    // Notify on visibility change
    React.useEffect(() => {
      if (onVisibilityChange) onVisibilityChange(hidden);
    }, [hidden, onVisibilityChange]);

    // Expose CSS var for height if requested
    React.useEffect(() => {
      if (!setCssVarName) return;
      try {
        document.documentElement.style.setProperty(
          setCssVarName,
          `${height}px`
        );
      } catch {}
    }, [height, setCssVarName]);

    // Imperative API
    React.useImperativeHandle(
      ref,
      () => ({
        show: () => setHidden(false),
        hide: () => setHidden(true),
        toggle: () => setHidden((h) => !h),
        measure: () => height,
      }),
      [height]
    );

    const positionClass = anchor === "top" ? "top-0" : "bottom-0";
    const innerSafeAreaStyle: React.CSSProperties =
      anchor === "bottom"
        ? { paddingBottom: "env(safe-area-inset-bottom)" }
        : { paddingTop: "env(safe-area-inset-top)" };
    return (
      <motion.div
        role={role}
        aria-label={ariaLabel}
        style={{ transform: translateY, ...(outerStyle || {}) }}
        className={[
          "fixed left-0 right-0 z-10 will-change-transform",
          positionClass,
          scrolled && showShadowAt != null
            ? anchor === "top"
              ? "shadow-sm"
              : "shadow-[0_-1px_0_0_rgba(0,0,0,0.06)]"
            : "",
          className || "",
        ].join(" ")}
      >
        <div
          className={innerClassName}
          ref={headerRef}
          style={{ ...(innerStyle || {}), ...innerSafeAreaStyle }}
        >
          {children}
        </div>
      </motion.div>
    );
  }
);

export default SlidingHeader;
