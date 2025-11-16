import type { ReactionEmoji } from "../../types";

export const LARGE_MEDIA_THRESHOLD = 6 * 1024 * 1024; // 6 MB

export const FAB_SHOW_DISTANCE_REM = 200;
export const FAB_HIDE_DISTANCE_REM = FAB_SHOW_DISTANCE_REM * 0.5;
export const FAB_SCROLL_IDLE_MS = 160;
export const FAB_AUTO_HIDE_MS = 2500;

export const QUICK_REACTION_EMOJIS: ReactionEmoji[] = [
  "👍",
  "❤️",
  "🔥",
  "😆",
  "😠",
  "😲",
  "😥",
];

export const RECORDING_WAVEFORM_CAP = 480;

export const RESPONSIVE_BUBBLE_WIDTH =
  "w-full max-w-full min-w-0 sm:max-w-[95%] md:max-w-[85%] lg:max-w-[72%] xl:max-w-[64%]";

export const UNIFIED_BUBBLE_BG = "#E9ECEF"; // Tailwind chat-bubble custom color
export const UNIFIED_BUBBLE_FG = "#0f172a"; // Tailwind slate-900
