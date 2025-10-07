// Color utilities for message bubbles

export type BubblePalette = readonly string[];

// Baseline palette (your curated light pastels)
export const DEFAULT_BUBBLE_PALETTE: BubblePalette = [
  "#e2d1f9", // lavender-mist
  "#c7f9cc", // mint-splash
  "#ffd6a5", // peach-fuzz
  "#a0c4ff", // baby-blue
  "#ffadad", // cotton-candy
  "#b0d8b2", // sage-green
  "#fdffb6", // lemon-chiffon
  "#ffa69e", // coral-light
  "#bde0fe", // powder-blue
  "#d8bbff", // lilac-dream
  "#ffc8dd", // melon-slice
  "#cde4a2", // matcha-cream
  "#9bf6ff", // sky-haze
  "#fdfdaf", // butter-cream
  "#ffb8d9", // dusty-rose
  "#d0f4de", // sherbet-lime
  "#ffd1ad", // apricot-cream
  "#b3c7ff", // periwinkle
  "#ffcbf2", // bubblegum
  "#bcead5", // aloe-vera
] as const;

export function hashSeed(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function pickBubbleColor(
  username: string,
  palette: BubblePalette = DEFAULT_BUBBLE_PALETTE
): string {
  const h = hashSeed(username || "");
  const idx = Math.abs(h) % palette.length;
  return palette[idx];
}

export function needsLightText(hex: string): boolean {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b; // relative luminance
  return l < 140; // keep black text for these light shades
}
