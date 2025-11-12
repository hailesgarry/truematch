import React from "react";

export type LikeCardProps = {
  username: string;
  firstName?: string | null;
  age?: number | null;
  photos?: string[] | null;
  imageUrl?: string | null;
  className?: string;
  onOpenProfile?: () => void;
};

const LikeCard: React.FC<LikeCardProps> = ({
  username,
  firstName,
  age = null,
  photos = null,
  imageUrl = null,
  className = "",
  onOpenProfile,
}) => {
  const displayName = (firstName ?? "").trim() || username;
  const accessibleName = `${displayName}${
    typeof age === "number" && Number.isFinite(age) ? `, ${age}` : ""
  }`;

  const primaryPhoto = React.useMemo(() => {
    if (Array.isArray(photos)) {
      for (const src of photos) {
        if (typeof src === "string" && src.trim()) {
          return src.trim();
        }
      }
    }
    if (typeof imageUrl === "string" && imageUrl.trim()) {
      return imageUrl.trim();
    }
    return "/placeholder.jpg";
  }, [photos, imageUrl]);

  const handleOpen = React.useCallback(() => {
    onOpenProfile?.();
  }, [onOpenProfile]);

  const isClickable = typeof onOpenProfile === "function";

  const nameLabel = React.useMemo(() => {
    const ageLabel =
      typeof age === "number" && Number.isFinite(age) && age > 0
        ? `, ${age}`
        : "";
    return `${displayName || "Member"}${ageLabel}`;
  }, [displayName, age]);

  return (
    <div
      className={[
        "relative w-full overflow-hidden rounded-2xl bg-gray-200 shadow-sm ring-1 ring-black/5 transition hover:shadow-md focus-within:ring-primary-500/70",
        "aspect-[3/4]",
        className,
      ].join(" ")}
    >
      <button
        type="button"
        onClick={isClickable ? handleOpen : undefined}
        disabled={!isClickable}
        className={[
          "relative block h-full w-full focus:outline-none",
          isClickable ? "cursor-pointer" : "cursor-default",
        ].join(" ")}
        aria-label={isClickable ? `Open ${accessibleName}` : undefined}
      >
        {primaryPhoto ? (
          <img
            src={primaryPhoto}
            alt={`${accessibleName} photo`}
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-300 text-xs font-medium text-gray-600">
            No photo available
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent">
          <div className="px-4 pb-4 pt-16">
            <div className="text-left text-lg font-semibold text-white">
              {nameLabel}
            </div>
          </div>
        </div>
      </button>
    </div>
  );
};

export default LikeCard;
