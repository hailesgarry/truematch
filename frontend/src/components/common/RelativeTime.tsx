import React from "react";

type TimeInput = number | Date | string | null | undefined;

export interface RelativeTimeProps {
  value: TimeInput; // ms epoch, Date, ISO string
  className?: string;
  // If provided, used when value is null/invalid
  fallback?: React.ReactNode;
  // Include the word "ago" (default true). Set false for bare: 1m, 3h, 2d
  withSuffix?: boolean;
  // Minimum unit to display; when set to 'minute', seconds are never shown
  minUnit?: "second" | "minute" | "hour" | "day";
  // If true and age is below minUnit, render nothing (or fallback if provided)
  hideBelowMin?: boolean;
  // When age is below minUnit (e.g., < 1m) show a friendly "Just now" instead of hiding
  // or showing seconds. Defaults to true so lists can show "Just now" naturally.
  showJustNowBelowMin?: boolean;
  // Customize the threshold and text for the "Just now" case
  justNowThresholdMs?: number; // default 60_000
  justNowText?: string; // default "Just now"
  // When minUnit="minute" and msAgo>0 but <1m, round up to 1m instead of 0m
  roundUpMinuteFloorToOne?: boolean;
}

// Format a compact relative time like: 5s, 2m, 1h, 3d, 2w, 4mo, 1y
function formatCompactRelative(msAgo: number): string {
  const s = Math.max(0, Math.floor(msAgo / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  const y = Math.floor(d / 365);
  return `${y}y`;
}

function toEpochMs(v: TimeInput): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return v.getTime();
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

// Pick a refresh cadence appropriate to the current distance so we don't rerender too often
function nextTickInterval(msAgo: number): number {
  if (msAgo < 60_000) return 1_000; // < 1m -> every second
  if (msAgo < 3_600_000) return 30_000; // < 1h -> every 30s
  if (msAgo < 86_400_000) return 300_000; // < 1d -> every 5m
  return 900_000; // else -> every 15m
}

const RelativeTime: React.FC<RelativeTimeProps> = ({
  value,
  className,
  fallback = "Offline",
  withSuffix = true,
  minUnit = "second",
  hideBelowMin = false,
  showJustNowBelowMin = true,
  justNowThresholdMs = 60_000,
  justNowText = "Just now",
  roundUpMinuteFloorToOne = false,
}) => {
  const [now, setNow] = React.useState(() => Date.now());
  const ts = toEpochMs(value);

  React.useEffect(() => {
    // if value missing, don't schedule updates
    if (ts == null) return;
    const tick = () => setNow(Date.now());
    const msAgo = now - ts;
    const interval = Math.max(1_000, nextTickInterval(msAgo));
    const id = setInterval(tick, interval);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ts, now]);

  if (ts == null) return <span className={className}>{fallback}</span>;
  const msAgo = Math.max(0, now - ts);

  // Special-case: below-minute window handled as "Just now" when desired
  if (
    minUnit === "minute" &&
    msAgo < (justNowThresholdMs || 60_000) &&
    showJustNowBelowMin
  ) {
    // Never add suffix to "Just now"
    try {
      const abs = new Date(ts).toLocaleString();
      return (
        <span className={className} title={abs} aria-label={justNowText}>
          {justNowText}
        </span>
      );
    } catch {
      return <span className={className}>{justNowText}</span>;
    }
  }

  // Enforce minimum unit and optional suppression (if not showing "Just now")
  if (minUnit === "minute" && msAgo < 60_000 && hideBelowMin) {
    return fallback != null ? (
      <span className={className}>{fallback}</span>
    ) : null;
  }

  const base = (() => {
    if (minUnit === "minute") {
      // Round down to full minutes (0m suppressed above if hideBelowMin)
      let m = Math.floor(msAgo / 60_000);
      if (roundUpMinuteFloorToOne && m === 0 && msAgo > 0) m = 1;
      if (m < 60) return `${m}m`;
      const h = Math.floor(m / 60);
      if (h < 24) return `${h}h`;
      const d = Math.floor(h / 24);
      if (d < 7) return `${d}d`;
      const w = Math.floor(d / 7);
      if (w < 5) return `${w}w`;
      const mo = Math.floor(d / 30);
      if (mo < 12) return `${mo}mo`;
      const y = Math.floor(d / 365);
      return `${y}y`;
    }
    return formatCompactRelative(msAgo);
  })();
  const compact = withSuffix ? base + " ago" : base;

  try {
    const abs = new Date(ts).toLocaleString();
    return (
      <span
        className={className}
        title={abs}
        aria-label={`Last active ${compact}`}
      >
        {compact}
      </span>
    );
  } catch {
    return <span className={className}>{compact}</span>;
  }
};

export default RelativeTime;
