import { createAvatar } from "@dicebear/core";
import { avataaars } from "@dicebear/collection";

export async function getDiceBearAvatar(name: string): Promise<string> {
  const seed = (name || "user").trim();
  try {
    return await createAvatar(avataaars, {
      seed,
      backgroundColor: ["65c9ff", "ffdfbf", "e6e6e6", "ffd5dc", "d2eff3"],
      backgroundType: ["gradientLinear"],
      radius: 50,
    }).toDataUri();
  } catch {
    return generateMonogramAvatar(seed);
  }
}

export function generateMonogramAvatar(name: string): string {
  const s = name.trim().toUpperCase() || "?";
  const initials =
    s
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("") || "?";
  const hash = Array.from(s).reduce(
    (h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0,
    0
  );
  const colors = [
    "#2563eb",
    "#db2777",
    "#059669",
    "#7c3aed",
    "#ea580c",
    "#0891b2",
    "#16a34a",
    "#9333ea",
  ];
  const bg = colors[Math.abs(hash) % colors.length];
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 128 128'>
    <defs>
      <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
        <stop offset='0%' stop-color='${bg}' />
        <stop offset='100%' stop-color='#111827' stop-opacity='0.12'/>
      </linearGradient>
    </defs>
    <rect width='128' height='128' rx='64' fill='url(#g)' />
    <text x='50%' y='50%' dy='.35em' text-anchor='middle'
      font-family='Inter,system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif'
      font-size='56' font-weight='700' fill='white'>${initials}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
