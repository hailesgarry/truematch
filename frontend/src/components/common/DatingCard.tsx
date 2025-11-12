import React from "react";
import {
  MapPin,
  Heart,
  Circle,
  NavigationArrow,
  ChatCircle,
} from "phosphor-react";
import {
  CircularProgressbarWithChildren,
  buildStyles,
} from "react-circular-progressbar";
import "react-circular-progressbar/dist/styles.css";
import type { DistanceUnit } from "../../stores/preferencesStore";
import { formatDistance } from "../../utils/distance";
import { usePresenceStore } from "../../stores/presenceStore";

type DatingCardProps = {
  firstName?: string | null;
  username: string;
  status?: string;
  imageUrl: string; // legacy/fallback first image
  photos?: string[]; // optional multi-photo support
  age?: number;
  city?: string;
  state?: string;
  country?: string;
  locationLabel?: string;
  liked?: boolean; // controlled like state
  // Optional gate: if provided and returns true, the like action is intercepted
  interceptLike?: () => boolean;
  onLike?: () => void; // called when toggling to liked
  onUnlike?: () => void; // called when toggling to unliked
  onWave?: () => void;
  onOpenProfile?: () => void;
  className?: string;
  distanceMeters?: number | null;
  distanceUnit?: DistanceUnit;
  matchPercentage?: number | null;
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
  firstName,
  username,
  imageUrl,
  photos,
  age,
  city,
  state,
  country,
  locationLabel,
  liked = false, // controlled
  interceptLike,
  onLike,
  onUnlike,
  onWave,
  onOpenProfile,
  className = "",
  distanceMeters = null,
  distanceUnit = "metric",
  matchPercentage: matchPercentageProp = null,
}) => {
  const primaryName = (firstName ?? "").trim();
  const accessibleName = primaryName || "member";
  const formattedLocation = React.useMemo(() => {
    const parts: string[] = [];
    const countryPart = country?.trim();
    const statePart = state?.trim();
    const cityPart = city?.trim();
    if (countryPart) parts.push(countryPart);
    if (statePart) parts.push(statePart);
    if (cityPart) parts.push(cityPart);
    if (parts.length === 0 && locationLabel) {
      const fallback = locationLabel.trim();
      if (fallback) parts.push(fallback);
    }
    return parts.join(", ");
  }, [country, state, city, locationLabel]);

  // Presence: online status
  const online = usePresenceStore((s) => s.isOnline(username));

  const displayImage = React.useMemo(() => {
    if (Array.isArray(photos) && photos.length) {
      return photos[0] ?? imageUrl;
    }
    return imageUrl;
  }, [photos, imageUrl]);

  const distanceLabel = React.useMemo(() => {
    if (
      typeof distanceMeters !== "number" ||
      !Number.isFinite(distanceMeters)
    ) {
      return "";
    }
    return formatDistance(distanceMeters, distanceUnit);
  }, [distanceMeters, distanceUnit]);
  const showDistance = distanceLabel.length > 0;

  const matchPercentage = React.useMemo(() => {
    if (matchPercentageProp === null || matchPercentageProp === undefined) {
      return null;
    }
    const numeric = Number(matchPercentageProp);
    if (!Number.isFinite(numeric)) return null;
    const clamped = Math.min(100, Math.max(10, Math.round(numeric)));
    return clamped;
  }, [matchPercentageProp]);

  // Animation state
  const [burst, setBurst] = React.useState<{
    id: number;
    particles: Particle[];
  } | null>(null);
  const lastBurstRef = React.useRef(0);
  const prevLikedRef = React.useRef(liked);
  const likeHandlersRef = React.useRef({ interceptLike, onLike, onUnlike });

  React.useEffect(() => {
    likeHandlersRef.current = { interceptLike, onLike, onUnlike };
  }, [interceptLike, onLike, onUnlike]);

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

  // Swipe gestures will eventually call the like/unlike handlers.
  // The legacy tap-to-like logic stays here for reference until swiping is wired.
  /*
  const handleLikeClick = () => {
    if (liked) {
      onUnlike?.();
    } else {
      if (interceptLike && interceptLike()) {
        return;
      }
      triggerBurst();
      onLike?.();
    }
  };
  */

  return (
    <div
      className={[
        "w-full aspect-[3/4] bg-white rounded-2xl overflow-hidden relative",
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

      {/* Photo taking full card height with overlaid content */}
      <div className="absolute inset-0 w-full h-full">
        {/* Background photo */}
        <div
          className="absolute inset-0 bg-gray-100"
          onClick={() => onOpenProfile?.()}
          onKeyDown={(e) => {
            if (!onOpenProfile) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpenProfile();
            }
          }}
          role={onOpenProfile ? "button" : undefined}
          tabIndex={onOpenProfile ? 0 : undefined}
          aria-label={
            onOpenProfile
              ? `Open ${accessibleName}'s dating profile`
              : undefined
          }
        >
          {displayImage ? (
            <img
              src={displayImage}
              alt={`${accessibleName} dating profile`}
              className="h-full w-full object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
              draggable={false}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm text-gray-500">
              No photo provided
            </div>
          )}
        </div>

        {/* Gradient overlay for text readability */}
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 via-black/30 to-transparent pointer-events-none" />

        {/* Content overlay at bottom */}
        <div className="absolute inset-x-0 bottom-0 px-4 pb-4 z-10 pointer-events-none">
          <div className="text-left">
            <div className="inline-flex items-center gap-1.5 text-lg font-semibold text-white">
              <span className="inline-flex items-center gap-1.5">
                {online && (
                  <Circle
                    size={12}
                    weight="fill"
                    className="text-green-500"
                    aria-hidden="true"
                  />
                )}
                <span>
                  {primaryName || "Member"}
                  {typeof age === "number" ? `, ${age}` : ""}
                </span>
              </span>
            </div>

            {formattedLocation ? (
              <div className="mt-0.5 text-sm font-medium text-white/90">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin
                    size={18}
                    weight="fill"
                    className="text-white/90"
                    aria-hidden="true"
                  />
                  <span>{formattedLocation}</span>
                </span>
              </div>
            ) : null}

            {showDistance ? (
              <div className="mt-0.5 text-sm font-medium text-white/85">
                <span className="inline-flex items-center gap-1.5">
                  <NavigationArrow
                    size={18}
                    weight="fill"
                    className="text-white/80"
                    aria-hidden="true"
                  />
                  <span>{distanceLabel}</span>
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Actions positioned on the photo */}
        <div className="absolute right-4 bottom-4 z-20 flex flex-col items-center gap-3">
          {matchPercentage !== null && (
            <div className="pointer-events-none">
              <div className="pointer-events-auto h-16 w-16">
                <svg style={{ height: 0, width: 0, position: "absolute" }}>
                  <defs>
                    <linearGradient
                      id="matchGradient"
                      x1="0%"
                      y1="0%"
                      x2="100%"
                      y2="0%"
                    >
                      <stop offset="0%" stopColor="#e91e8c" />
                      <stop offset="30%" stopColor="#d41f8e" />
                      <stop offset="50%" stopColor="#ca209e" />
                      <stop offset="70%" stopColor="#c820c8" />
                      <stop offset="100%" stopColor="#b521d4" />
                    </linearGradient>
                  </defs>
                </svg>
                <CircularProgressbarWithChildren
                  value={matchPercentage}
                  strokeWidth={8}
                  styles={buildStyles({
                    pathColor: "url(#matchGradient)",
                    trailColor: "rgba(255,255,255,0.5)",
                    strokeLinecap: "round",
                  })}
                >
                  <div className="flex h-full w-full items-center justify-center">
                    <div className="flex h-12 w-12 flex-col items-center justify-center rounded-full bg-transparent text-white/90">
                      <span className="text-sm font-semibold leading-none">
                        {matchPercentage}%
                      </span>
                      <span className="text-[10px] font-medium tracking-wide leading-tight text-white/90">
                        Match
                      </span>
                    </div>
                  </div>
                </CircularProgressbarWithChildren>
              </div>
            </div>
          )}

          {/* Heart icon removed; swiping will trigger like/unlike when implemented */}
          <div className="relative">
            {burst && (
              <div
                className="pointer-events-none absolute inset-0 flex items-center justify-center"
                style={{ zIndex: 1 }}
              >
                <div
                  className="absolute left-1/2 top-1/2"
                  style={{
                    animation: "dc-float-up 700ms ease-out forwards",
                    transform: "translate(-50%, -50%)",
                    color: "#ef4444",
                  }}
                  aria-hidden="true"
                >
                  <Heart size={20} weight="fill" />
                </div>

                {burst.particles.map((p, idx) => (
                  <div
                    key={`${burst.id}-${idx}`}
                    className="absolute left-1/2 top-1/2"
                    style={
                      {
                        transform: "translate(-50%, -50%) rotate(var(--r))",
                        ["--r" as any]: `${p.rotate}deg`,
                      } as React.CSSProperties
                    }
                    aria-hidden="true"
                  >
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
            aria-label={`Chat with ${accessibleName}`}
            onClick={onWave}
            className="w-11 h-11 rounded-full active:scale-95 transition inline-flex items-center justify-center shadow-[0_2px_6px_rgba(15,23,42,0.14)] bg-primary-gradient text-white border-transparent"
          >
            <ChatCircle size={22} weight="fill" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default DatingCard;
