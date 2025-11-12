/*
  Script: generate-icons.ts
  - Builds SVG favicon from LogoMark
  - Renders PNGs at standard sizes for favicons and PWA
  Requires: node >=18
*/
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// Core SVG template matching LogoMark.tsx output
function buildSvg(size = 512) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg width="${size}" height="${size}" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">\n` +
    `  <rect x="0" y="0" width="128" height="128" rx="24" fill="#ef4444" />\n` +
    `  <text x="64" y="64" text-anchor="middle" dominant-baseline="middle"\n` +
    `        font-family="'Plus Jakarta Sans', Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif"\n` +
    `        font-weight="800" font-size="72" letter-spacing="-2" fill="#ffffff">tm</text>\n` +
    `</svg>`
  );
}

// Lightweight SVG->PNG via canvaskit-wasm or jimp fallback would add deps;
// to keep it simple for now, we only write out SVG and rely on Vite/you to rasterize if needed.
// If you want me to wire a rasterizer now, I can add 'sharp' or 'resvg-js'.

function main() {
  const publicDir = join(process.cwd(), "frontend", "public");
  mkdirSync(publicDir, { recursive: true });

  const faviconSvg = buildSvg(128);
  writeFileSync(join(publicDir, "favicon.svg"), faviconSvg, "utf8");
  writeFileSync(
    join(publicDir, "safari-pinned-tab.svg"),
    faviconSvg.replace("#ef4444", "#000000"),
    "utf8"
  );

  // PWA icons (SVG source). PNG rasterization step is optional and not included here.
  // Standard sizes to generate as PNG:
  // - 16x16, 32x32, 48x48 (classic favicons)
  // - 180x180 (apple touch)
  // - 192x192, 256x256, 384x384, 512x512 (PWA)
  // You can run a rasterization tool to convert this SVG to those PNG sizes.
}

main();
