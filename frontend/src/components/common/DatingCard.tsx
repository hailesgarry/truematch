import React from "react";
import { ChatCircleDots, MapPin, Heart } from "phosphor-react";
import { usePresenceStore } from "../../stores/presenceStore";
import RelativeTime from "./RelativeTime";

type DatingCardProps = {
  name: string;
  status?: string;
  imageUrl: string; // legacy/fallback first image
  photos?: string[]; // optional multi-photo support
  age?: number;
  city?: string;
  state?: string;
  locationLabel?: string;
  liked?: boolean; // controlled like state
  // Optional gate: if provided and returns true, the like action is intercepted
  interceptLike?: () => boolean;
  onLike?: () => void; // called when toggling to liked
  onUnlike?: () => void; // called when toggling to unliked
  onWave?: () => void;
  className?: string;
};

type Particle = {
  x: number;
  y: number;
  delay: number;
  size: number;
  hue: number;
  rotate: number; // NEW: random rotation in degrees
};

const DatingCard: React.FC<DatingCardProps> = ({
  name,
  status = "",
  imageUrl,
  photos,
  age,
  city,
  state,
  locationLabel,
  liked = false, // controlled
  interceptLike,
  onLike,
  onUnlike,
  onWave,
  className = "",
}) => {
  const formattedLocation =
    [city, state].filter(Boolean).join(", ") || locationLabel || "";

  // Presence: online/offline + last active
  const online = usePresenceStore((s) => s.isOnline(name));
  // Subscribe directly to the derived value so it updates when the store changes
  const lastActive = usePresenceStore((s) => s.getLastActive(name) ?? null);

  // Gallery state
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const images: string[] = React.useMemo(() => {
    const arr = (photos || []).filter(Boolean);
    if (arr.length > 0) return arr;
    return imageUrl ? [imageUrl] : [];
  }, [photos, imageUrl]);
  const [idx, setIdx] = React.useState(0);
  React.useEffect(() => {
    setIdx((i) => (images.length ? Math.min(i, images.length - 1) : 0));
  }, [images.length]);

  // Touch swipe (mobile)
  const drag = React.useRef({
    active: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    width: 0,
    lockDir: "" as "" | "x" | "y",
  });
  const [dragDx, setDragDx] = React.useState(0); // px

  const onTouchStart: React.TouchEventHandler<HTMLDivElement> = (e) => {
    if (!images || images.length <= 1) return;
    const t = e.touches[0];
    drag.current.active = true;
    drag.current.startX = t.clientX;
    drag.current.startY = t.clientY;
    drag.current.lastX = t.clientX;
    drag.current.width = containerRef.current?.clientWidth || 1;
    drag.current.lockDir = "";
    setDragDx(0);
  };
  const onTouchMove: React.TouchEventHandler<HTMLDivElement> = (e) => {
    if (!drag.current.active) return;
    const t = e.touches[0];
    const dx = t.clientX - drag.current.startX;
    const dy = t.clientY - drag.current.startY;
    // lock scroll direction to avoid vertical scroll conflicts
    if (!drag.current.lockDir) {
      if (Math.abs(dx) > 8) drag.current.lockDir = "x";
      else if (Math.abs(dy) > 8) drag.current.lockDir = "y";
    }
    if (drag.current.lockDir === "y") return; // allow page scroll
    if (drag.current.lockDir === "x") {
      // Prevent vertical scroll while swiping horizontally
      try {
        e.preventDefault();
      } catch {}
    }
    drag.current.lastX = t.clientX;
    setDragDx(dx);
  };
  const finishSwipe = (dx: number) => {
    const width = drag.current.width || 1;
    const threshold = Math.max(40, width * 0.12);
    if (Math.abs(dx) > threshold) {
      if (dx < 0 && idx < images.length - 1) setIdx(idx + 1);
      else if (dx > 0 && idx > 0) setIdx(idx - 1);
    }
    setDragDx(0);
  };
  const onTouchEnd: React.TouchEventHandler<HTMLDivElement> = () => {
    if (!drag.current.active) return;
    finishSwipe(dragDx);
    drag.current.active = false;
    drag.current.lockDir = "";
  };
  const onTouchCancel: React.TouchEventHandler<HTMLDivElement> = () => {
    if (!drag.current.active) return;
    setDragDx(0);
    drag.current.active = false;
    drag.current.lockDir = "";
  };

  // Animation state
  const [burst, setBurst] = React.useState<{
    id: number;
    particles: Particle[];
  } | null>(null);
  const lastBurstRef = React.useRef(0);
  const prevLikedRef = React.useRef(liked);

  const makeParticles = React.useCallback((): Particle[] => {
    const count = 12;
    const particles: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6; // slight variance
      const dist = 26 + Math.random() * 22; // px
      const x = Math.cos(angle) * dist;
      const y = Math.sin(angle) * dist;
      const delay = Math.random() * 120; // ms
      const size = 10 + Math.random() * 6; // icon px
      const hue = 350 + Math.random() * 20; // pink-red (350-370)
      const rotate = (Math.random() - 0.5) * 70; // -35deg to 35deg
      particles.push({ x, y, delay, size, hue, rotate });
    }
    return particles;
  }, []);

  const triggerBurst = React.useCallback(() => {
    const now = Date.now();
    // debounce to avoid double-fire from click + prop update
    if (now - lastBurstRef.current < 250) return;
    lastBurstRef.current = now;

    setBurst({ id: now, particles: makeParticles() });
    // clear after animation completes
    window.setTimeout(() => setBurst(null), 800);
  }, [makeParticles]);

  // Rising-edge animation when external liked toggles to true
  React.useEffect(() => {
    if (!prevLikedRef.current && liked) {
      triggerBurst();
    }
    prevLikedRef.current = liked;
  }, [liked, triggerBurst]);

  const handleLikeClick = () => {
    if (liked) {
      onUnlike?.();
    } else {
      // Allow parent to intercept (e.g., require a profile)
      if (interceptLike && interceptLike()) {
        return;
      }
      // play animation immediately for responsiveness
      triggerBurst();
      onLike?.();
    }
  };

  return (
    <div
      className={[
        "w-full bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-[0_2px_8px_rgba(0,0,0,0.04),_0_8px_20px_rgba(0,0,0,0.02)]",
        className,
      ].join(" ")}
    >
      {/* Inline keyframes (scoped by class names to avoid collisions) */}
      <style>
        {`
        @keyframes dc-float-up {
          0% { transform: translate(-50%, -50%) scale(0.9); opacity: 0; }
          20% { opacity: 1; }
          100% { transform: translate(-50%, -90%) scale(1.18); opacity: 0; }
        }
        @keyframes dc-burst {
          0% { transform: translate(0, 0) scale(0.9); opacity: 1; }
          100% { transform: translate(var(--x), var(--y)) scale(0.8); opacity: 0; }
        }
        `}
      </style>

      {/* Photo carousel with online/offline indicator overlay */}
      <div
        className="w-full aspect-square bg-gray-100 relative overflow-hidden"
        ref={containerRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
      >
        <div
          className={"h-full w-full flex select-none"}
          style={{
            transform: `translateX(calc(${-idx * 100}% + ${
              images.length > 1 ? (dragDx / (drag.current.width || 1)) * 100 : 0
            }%))`,
            transition:
              dragDx === 0
                ? "transform 300ms cubic-bezier(.2,.7,.2,1)"
                : "none",
          }}
        >
          {images.map((src, i) => (
            <img
              key={`${src}-${i}`}
              src={src}
              alt={`${name} photo ${i + 1}`}
              className="w-full h-full object-cover shrink-0 grow-0 basis-full"
              loading={i === 0 ? "eager" : "lazy"}
              referrerPolicy="no-referrer"
              draggable={false}
            />
          ))}
        </div>

        {/* Online/Offline indicator (overlay on image) */}
        <div className="absolute left-2 bottom-2">
          {online ? (
            <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/90 text-gray-900 text-xs shadow-sm">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full bg-green-500"
                aria-hidden="true"
              />
              <span className="font-medium">Online</span>
            </div>
          ) : (
            <div className="inline-flex items-center px-2 py-1 rounded-md bg-white/85 text-gray-800 text-[11px] shadow-sm">
              {lastActive ? (
                <span className="whitespace-nowrap">
                  Last seen{" "}
                  <RelativeTime
                    value={lastActive}
                    withSuffix
                    minUnit="minute"
                    hideBelowMin={false}
                    showJustNowBelowMin={true}
                    justNowThresholdMs={60_000}
                    roundUpMinuteFloorToOne={true}
                  />
                </span>
              ) : (
                <span className="whitespace-nowrap">Offline</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Dots indicator (clickable on desktop). Hidden if only one image */}
      {images.length > 1 && (
        <div className="w-full flex items-center justify-center mt-2">
          <div className="inline-flex items-center gap-2">
            {images.map((_, i) => (
              <button
                key={`dot-${i}`}
                type="button"
                className={[
                  "w-2.5 h-2.5 rounded-full",
                  i === idx ? "bg-gray-800" : "bg-gray-300 hover:bg-gray-400",
                ].join(" ")}
                aria-label={`Show photo ${i + 1}`}
                onClick={() => setIdx(i)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Name + age on first line; city/state (or locationLabel) below; status */}
      <div className="p-4">
        <div className="text-center">
          <div className="text-lg font-semibold text-gray-900">
            <span>{name}</span>
            {typeof age === "number" ? (
              <span className="ml-1">, {age}</span>
            ) : null}
          </div>

          {formattedLocation ? (
            <div className="mt-0.5 text-sm font-medium text-gray-500">
              <span className="inline-flex items-center gap-1.5 justify-center">
                <MapPin
                  size={14}
                  weight="fill"
                  className="text-gray-500"
                  aria-hidden="true"
                />
                <span>{formattedLocation}</span>
              </span>
            </div>
          ) : null}

          {status ? (
            <div className="text-sm text-gray-900 mt-2">
              <span className="font-serif italic">“ {status} ”</span>
            </div>
          ) : null}
        </div>

        {/* Actions */}
        <div className="mt-4 flex items-center justify-center gap-10">
          {/* Like button wrapper for animation overlay */}
          <div className="relative">
            <button
              type="button"
              aria-label={`Like ${name}`}
              onClick={handleLikeClick}
              className={[
                "w-11 h-11 rounded-full active:scale-95 transition inline-flex items-center justify-center",
                liked
                  ? "bg-red-50 text-red-500"
                  : "bg-red-500 text-white border-transparent",
              ].join(" ")}
            >
              <Heart size={22} weight="fill" />
            </button>

            {/* Floating heart + particles (shown when burst is active) */}
            {burst && (
              <div
                className="pointer-events-none absolute inset-0 flex items-center justify-center"
                // ensure above button
                style={{ zIndex: 1 }}
              >
                {/* Floating heart */}
                <div
                  className="absolute left-1/2 top-1/2"
                  style={{
                    animation: "dc-float-up 700ms ease-out forwards",
                    transform: "translate(-50%, -50%)",
                    color: "#ef4444", // red-500
                  }}
                  aria-hidden="true"
                >
                  <Heart size={20} weight="fill" />
                </div>

                {/* Heart particles */}
                {burst.particles.map((p, idx) => (
                  <div
                    key={`${burst.id}-${idx}`}
                    className="absolute left-1/2 top-1/2"
                    // Outer: center + random rotation
                    style={
                      {
                        transform: "translate(-50%, -50%) rotate(var(--r))",
                        ["--r" as any]: `${p.rotate}deg`,
                      } as React.CSSProperties
                    }
                    aria-hidden="true"
                  >
                    {/* Inner: animated translation + scale */}
                    <div
                      style={
                        {
                          animation: `dc-burst 600ms ${p.delay}ms cubic-bezier(.2,.7,.2,1) forwards`,
                          ["--x" as any]: `${p.x}px`,
                          ["--y" as any]: `${p.y}px`,
                          color: `hsl(${p.hue} 90% 60%)`,
                          filter: `drop-shadow(0 0 0.5px hsla(${p.hue} 90% 30% / 0.6))`,
                        } as React.CSSProperties
                      }
                    >
                      <Heart size={Math.round(p.size)} weight="fill" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            aria-label={`Wave at ${name}`}
            onClick={onWave}
            className="w-11 h-11 rounded-full text-white bg-red-500 active:scale-95 transition inline-flex items-center justify-center shadow-sm"
          >
            <ChatCircleDots size={22} weight="fill" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default DatingCard;
