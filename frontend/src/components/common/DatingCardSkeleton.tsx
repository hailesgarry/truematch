import React from "react";

// Visual skeleton placeholder that mirrors the layout of DatingCard
const DatingCardSkeleton: React.FC<{ className?: string }> = ({
  className = "",
}) => {
  return (
    <div
      className={[
        "w-full aspect-[3/4] bg-white rounded-2xl overflow-hidden relative",
        "animate-pulse",
        className,
      ].join(" ")}
      aria-hidden
    >
      {/* Background image placeholder */}
      <div className="absolute inset-0 w-full h-full">
        <div className="absolute inset-0 bg-gray-200" />

        {/* Gradient overlay for text readability */}
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 via-black/30 to-transparent pointer-events-none" />

        {/* Content overlay at bottom */}
        <div className="absolute inset-x-0 bottom-0 px-4 pb-4 z-10 pointer-events-none">
          <div className="text-left space-y-2">
            {/* Name + age line */}
            <div className="h-5 w-32 rounded bg-white/30" />

            {/* Location line */}
            <div className="h-4 w-40 rounded bg-white/25" />

            {/* Distance line */}
            <div className="h-4 w-28 rounded bg-white/25" />
          </div>
        </div>

        {/* Actions positioned on the photo */}
        <div className="absolute right-4 bottom-4 z-20 flex flex-col items-center gap-3">
          {/* Match percentage circle */}
          <div className="h-16 w-16 rounded-full bg-white/20" />

          {/* Chat button */}
          <div className="w-11 h-11 rounded-full bg-white/30" />
        </div>
      </div>
    </div>
  );
};

export default DatingCardSkeleton;
