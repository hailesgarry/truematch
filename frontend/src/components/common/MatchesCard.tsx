import React, { useEffect, useMemo, useState } from "react";
import {
  buildStyles,
  CircularProgressbarWithChildren,
} from "react-circular-progressbar";
import "react-circular-progressbar/dist/styles.css";
import type { DatingProfile } from "../../types";
import { collectDatingPhotos } from "../../utils/datingPhotos";

type MatchesCardProps = {
  profiles: DatingProfile[];
  onSelectProfile?: (profile: DatingProfile) => void;
  title?: string;
};

const PLACEHOLDER_IMAGE = "/placeholder.jpg";
const DEFAULT_CHAT_WINDOW_MS = 48 * 60 * 60 * 1000; // Placeholder window until backend powers this data

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const toTimestamp = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
};

const deriveExpiryWindow = (
  profile: DatingProfile
): { start: number; end: number } => {
  const anyProfile = profile as unknown as Record<string, unknown>;
  const rawEnd =
    toTimestamp(anyProfile.matchExpiresAt) ??
    toTimestamp(anyProfile.expiresAt) ??
    toTimestamp(anyProfile.chatExpiresAt);

  const basis =
    toTimestamp(anyProfile.matchedAt) ??
    toTimestamp(anyProfile.likedAt) ??
    toTimestamp(anyProfile.createdAt) ??
    toTimestamp(anyProfile.updatedAt) ??
    toTimestamp(anyProfile.datingProfileCreatedAt) ??
    Date.now();

  const end = rawEnd ?? basis + DEFAULT_CHAT_WINDOW_MS;
  const startCandidate = rawEnd ? rawEnd - DEFAULT_CHAT_WINDOW_MS : basis;
  const start = Math.min(startCandidate, end - 1);
  return { start, end };
};

const MatchesCard: React.FC<MatchesCardProps> = ({
  profiles,
  onSelectProfile,
  title = "Matches",
}) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const items = useMemo(
    () =>
      Array.isArray(profiles)
        ? profiles
            .filter((profile): profile is DatingProfile => Boolean(profile))
            .slice(0, 20)
        : [],
    [profiles]
  );

  return (
    <div className="rounded-2xl bg-white">
      <div className="mb-4 text-base font-semibold text-gray-900">{title}</div>
      {items.length === 0 ? (
        <div className="text-sm text-gray-500">No matches yet.</div>
      ) : (
        <div className="flex gap-3 overflow-x-auto">
          {items.map((profile, index) => {
            const identifier =
              (typeof profile?.userId === "string" && profile.userId.trim()) ||
              (typeof profile?.username === "string" &&
                profile.username.trim()) ||
              "";
            if (!identifier) return null;

            const username =
              (typeof profile?.username === "string" &&
                profile.username.trim()) ||
              identifier;

            const displayName =
              (typeof profile?.firstName === "string" &&
                profile.firstName.trim()) ||
              (typeof profile?.displayName === "string" &&
                profile.displayName.trim()) ||
              username;

            const photos = collectDatingPhotos(profile);
            const avatarSrc = photos[0] || PLACEHOLDER_IMAGE;

            const { start, end } = deriveExpiryWindow(profile);
            const total = Math.max(end - start, 1);
            const elapsed = clamp(now - start, 0, total);
            const progress = (elapsed / total) * 100;
            const gradientId = `matches-card-primary-gradient-${index}`;
            const pathColor = `url(#${gradientId})`;
            const trailColor = "#E5E7EB";

            const handleClick = () => {
              if (typeof onSelectProfile === "function") {
                onSelectProfile(profile);
              }
            };

            return (
              <button
                key={`${identifier}-${index}`}
                type="button"
                onClick={handleClick}
                className="flex w-[5rem] flex-shrink-0 flex-col items-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                aria-label={`Open profile for ${displayName}`}
              >
                <div className="h-[5rem] w-[5rem]">
                  <CircularProgressbarWithChildren
                    value={progress}
                    strokeWidth={6}
                    styles={buildStyles({
                      pathColor,
                      trailColor,
                      strokeLinecap: "round",
                      pathTransitionDuration: 0.5,
                    })}
                  >
                    <svg aria-hidden="true" style={{ height: 0 }}>
                      <defs>
                        <linearGradient
                          id={gradientId}
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
                    <div className="h-[4.3rem] w-[4.3rem] overflow-hidden rounded-full border border-gray-200 bg-gray-100">
                      <img
                        src={avatarSrc}
                        alt={
                          displayName
                            ? `${displayName}'s avatar`
                            : "Profile avatar"
                        }
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  </CircularProgressbarWithChildren>
                </div>
                <span className="mt-2 w-[5rem] truncate text-center text-xs text-gray-600">
                  {displayName}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MatchesCard;
