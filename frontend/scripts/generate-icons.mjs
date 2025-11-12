// Generates PNG icons from favicon.svg using sharp
// Sizes include classic favicons, apple touch, and PWA sizes
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");
const srcSvg = path.join(publicDir, "favicon.svg");

if (!fs.existsSync(srcSvg)) {
  console.error("Missing favicon.svg at", srcSvg);
  process.exit(1);
}

const SIZES = [
  16,
  32,
  48, // classic favicon sizes
  150, // Windows tile recommendation (mstile-150x150)
  180, // apple touch icon
  192,
  256,
  384,
  512, // PWA sizes
];

async function run() {
  const svgText = fs.readFileSync(srcSvg, "utf8");

  // Create a text-only variant by removing/filling the background rect
  const textOnlySvg = svgText.replace(
    /<rect[^>]*>/i,
    '<rect x="0" y="0" width="128" height="128" fill="none"/>'
  );

  // Rasterize text-only at high density, then trim to the glyph's tight bounding box
  const glyphBase = await sharp(Buffer.from(textOnlySvg), { density: 600 })
    .png()
    .toBuffer();
  const glyphTrimmed = await sharp(glyphBase).trim().toBuffer();
  const glyphMeta = await sharp(glyphTrimmed).metadata();

  // Helper to build rounded-rect background as SVG for perfect corners at each size
  const buildBgSvg = (size) => {
    const rx = Math.round(size * (24 / 128)); // keep same corner ratio as source
    return Buffer.from(
      `<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"${size}\" height=\"${size}\" viewBox=\"0 0 ${size} ${size}\">` +
        `<rect width=\"${size}\" height=\"${size}\" rx=\"${rx}\" fill=\"#ef4444\"/>` +
        `</svg>`
    );
  };

  // Target glyph height as a proportion of the icon size for consistent look
  const GLYPH_HEIGHT_RATIO = 0.58; // target max height proportion
  const GLYPH_WIDTH_RATIO = 0.82; // target max width proportion to avoid overflow

  for (const size of SIZES) {
    const outPath = path.join(publicDir, `pwa-${size}x${size}.png`);

    // Prepare background
    const bgPng = await sharp(buildBgSvg(size))
      .png({ compressionLevel: 9 })
      .toBuffer();

    // Resize glyph to target visual height
    const targetGlyphH = Math.max(1, Math.floor(size * GLYPH_HEIGHT_RATIO));
    const targetGlyphW = Math.max(1, Math.floor(size * GLYPH_WIDTH_RATIO));
    const scaledGlyph = await sharp(glyphTrimmed)
      .resize({
        width: targetGlyphW,
        height: targetGlyphH,
        fit: "inside",
        withoutEnlargement: false,
      })
      .toBuffer();

    // Composite glyph centered on background
    const final = await sharp(bgPng)
      .composite([{ input: scaledGlyph, gravity: "center" }])
      .png({ compressionLevel: 9 })
      .toBuffer();

    fs.writeFileSync(outPath, final);
    console.log("Wrote", outPath);
  }

  // Also produce a conventional apple-touch-icon.png (180x180)
  {
    const size = 180;
    const bg = await sharp(buildBgSvg(size)).png().toBuffer();
    const targetGlyphH = Math.max(1, Math.floor(size * GLYPH_HEIGHT_RATIO));
    const targetGlyphW = Math.max(1, Math.floor(size * GLYPH_WIDTH_RATIO));
    const scaledGlyph = await sharp(glyphTrimmed)
      .resize({
        width: targetGlyphW,
        height: targetGlyphH,
        fit: "inside",
        withoutEnlargement: false,
      })
      .toBuffer();
    const apple = await sharp(bg)
      .composite([{ input: scaledGlyph, gravity: "center" }])
      .png({ compressionLevel: 9 })
      .toBuffer();
    fs.writeFileSync(path.join(publicDir, "apple-touch-icon.png"), apple);
    console.log("Wrote", path.join(publicDir, "apple-touch-icon.png"));
  }

  // Produce favicon.ico combining 16/32/48
  const icoBuffers = [16, 32, 48].map((s) =>
    fs.readFileSync(path.join(publicDir, `pwa-${s}x${s}.png`))
  );
  const ico = await pngToIco(icoBuffers);
  fs.writeFileSync(path.join(publicDir, "favicon.ico"), ico);
  console.log("Wrote", path.join(publicDir, "favicon.ico"));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
