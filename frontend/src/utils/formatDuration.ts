export function formatDuration(durationMs?: number | null): string {
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs <= 0) {
    return "--:--";
  }
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60).toString();
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}
