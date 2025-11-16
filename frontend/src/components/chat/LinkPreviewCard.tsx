import React from "react";
import {
  useLinkPreview,
  type LinkPreviewData,
} from "../../hooks/useLinkPreview";
import { getHostFromUrl } from "../../utils/links";
import { PREVIEW_SURFACE_CLASSES } from "./previewSurfaceClasses";

export const LinkPreviewSkeleton: React.FC<{ className?: string }> = ({
  className,
}) => {
  const classes = [
    "rounded-xl",
    PREVIEW_SURFACE_CLASSES,
    "flex w-full max-w-full min-w-0 overflow-hidden text-left",
    "animate-pulse",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <div className="relative hidden h-full max-h-32 w-20 flex-shrink-0 bg-gray-200/60 sm:block sm:w-24" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 bg-white/10 p-3">
        <div className="h-4 w-4/5 rounded bg-white/70" />
        <div className="h-3 w-11/12 rounded bg-white/40" />
        <div className="h-3 w-3/4 rounded bg-white/30" />
        <div className="mt-auto h-3 w-1/2 rounded bg-white/40" />
      </div>
    </div>
  );
};

type Props = {
  url: string;
  className?: string;
  data?: LinkPreviewData | null;
};

const LinkPreviewCard: React.FC<Props> = ({ url, className, data }) => {
  const shouldFetch = data === undefined;
  const {
    data: fetched,
    isLoading,
    isError,
  } = useLinkPreview(url, {
    enabled: shouldFetch,
  });

  if (shouldFetch && isLoading) {
    return <LinkPreviewSkeleton className={className} />;
  }

  if (shouldFetch && isError) {
    return null;
  }

  const meta = data ?? fetched;
  if (!meta) {
    return null;
  }

  const targetUrl = meta.finalUrl || meta.url || url;
  const host = getHostFromUrl(targetUrl) || getHostFromUrl(url) || "";
  const displayUrl = (host || targetUrl.replace(/^https?:\/\//i, "")).replace(
    /\/$/,
    ""
  );

  const classes = [
    "group flex w-full max-w-full min-w-0 overflow-hidden text-left transition",
    "rounded-xl",
    PREVIEW_SURFACE_CLASSES,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <a
      href={targetUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={classes}
    >
      {meta.image ? (
        <div className="relative flex-shrink-0 bg-gray-100/80 max-h-32 w-20 sm:w-24 overflow-hidden">
          <div className="h-full w-full" style={{ display: "block" }}>
            <img
              src={meta.image}
              alt={meta.title || host || "Link preview"}
              className="h-full w-full max-w-full object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-1 p-3 overflow-hidden bg-white/10">
        {meta.title ? (
          <div className="truncate text-sm font-semibold text-gray-900">
            {meta.title}
          </div>
        ) : null}
        {meta.description ? (
          <div className="line-clamp-2 text-xs leading-snug text-gray-900">
            {meta.description}
          </div>
        ) : null}
        {displayUrl ? (
          <div className="truncate text-xs font-medium text-gray-500">
            {displayUrl}
          </div>
        ) : null}
      </div>
    </a>
  );
};

export default LinkPreviewCard;
