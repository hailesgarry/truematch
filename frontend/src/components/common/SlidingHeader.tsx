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
  springConfig?: Partial<{
    stiffness: number;
    damping: number;
    mass: number;
    restDelta: number;
    restSpeed: number;
  }>; // override spring options
  children: React.ReactNode;
};

const SlidingHeader: React.FC<SlidingHeaderProps> = ({
  scrollRef,
  className,
  innerClassName,
  deltaThreshold = 12,
  alwaysShowAtTop = 4,
  springConfig,
  children,
}) => {
  const [hidden, setHidden] = React.useState(false);
  const lastScrollTopRef = React.useRef(0);
  // Motion values for smooth Y translation
  const y = useMotionValue(0);
  const springOpts = React.useMemo(
    () => ({ stiffness: 520, damping: 38, mass: 0.6, ...(springConfig || {}) }),
    [springConfig]
  );
  const ySpring = useSpring(y, springOpts);
  const translateY = useTransform(ySpring, (val) => `translateY(${val}px)`);
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
    const target = scrollRef?.current || null;
    if (!target) return;

    const onScroll = () => {
      const st = target.scrollTop;
      if (st <= alwaysShowAtTop) {
        setHidden(false);
        // snap to shown
        requestAnimationFrame(() => {
          y.set(0);
        });
        lastScrollTopRef.current = st;
        return;
      }
      const delta = st - lastScrollTopRef.current;
      if (Math.abs(delta) < deltaThreshold) return;
      setHidden(delta < 0); // hide when scrolling UP
      lastScrollTopRef.current = st;
    };

    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  }, [scrollRef, deltaThreshold, alwaysShowAtTop]);

  // Animate to hidden position (-measured height) or 0
  React.useEffect(() => {
    const target = hidden ? -Math.max(height, 0) : 0;
    y.stop();
    y.set(target);
  }, [hidden, y, height]);

  return (
    <motion.div
      style={{ transform: translateY }}
      className={[
        "fixed top-0 left-0 right-0 z-10 will-change-transform",
        className || "",
      ].join(" ")}
    >
      <div className={innerClassName} ref={headerRef}>
        {children}
      </div>
    </motion.div>
  );
};

export default SlidingHeader;
