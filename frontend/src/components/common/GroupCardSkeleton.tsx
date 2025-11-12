import React from "react";

type GroupCardSkeletonProps = {
  className?: string;
  borderless?: boolean;
  marginless?: boolean;
  innerPaddingClassName?: string;
  showMembersSection?: boolean;
};

// Skeleton placeholder that mirrors the layout of GroupCard for loading states
const GroupCardSkeleton: React.FC<GroupCardSkeletonProps> = ({
  className = "",
  borderless = false,
  marginless = false,
  innerPaddingClassName,
  showMembersSection = true,
}) => {
  return (
    <div
      className={[
        "w-full rounded-2xl bg-white",
        "animate-pulse",
        borderless ? "" : "border border-gray-100",
        marginless ? "" : "mb-3",
        className,
      ].join(" ")}
      aria-hidden
    >
      <div
        className={[
          "relative flex flex-col",
          innerPaddingClassName ?? "p-4",
        ].join(" ")}
      >
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-[14px] bg-gray-200 flex-shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="h-4 w-40 rounded bg-gray-200" />
            <div className="h-3 w-24 rounded bg-gray-200" />
          </div>
        </div>

        <div className="mt-4 flex min-w-0 items-start justify-between gap-2">
          <div className="flex-1 space-y-2">
            <div className="h-3 w-full rounded bg-gray-200" />
            <div className="h-3 w-5/6 rounded bg-gray-200" />
          </div>
          <div className="h-4 w-10 rounded-full bg-gray-200" />
        </div>

        {showMembersSection ? (
          <div className="mt-4 flex items-center justify-between">
            <div className="flex items-center -space-x-2">
              <span className="inline-block h-8 w-8 rounded-full bg-gray-200" />
              <span className="inline-block h-8 w-8 rounded-full bg-gray-200" />
              <span className="inline-block h-8 w-8 rounded-full bg-gray-200" />
            </div>
            <div className="h-7 min-w-[88px] rounded-full bg-gray-200" />
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default GroupCardSkeleton;
