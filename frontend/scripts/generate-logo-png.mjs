// Generates PNG logo variants from public/logo.svg using sharp
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");
const srcSvg = path.join(publicDir, "logo.svg");

if (!fs.existsSync(srcSvg)) {
  console.error("Missing logo.svg at", srcSvg);
  process.exit(1);
}

// Common UI sizes for header usage (widths)
const WIDTHS = [160, 200, 256, 320];

async function run() {
  const svgBuffer = fs.readFileSync(srcSvg);

  // Render at higher density, then trim transparent borders for tight bounding box
  const basePng = await sharp(svgBuffer, { density: 300 }).png().toBuffer();
  const trimmed = await sharp(basePng).trim().toBuffer();

  for (const width of WIDTHS) {
    const outPath = path.join(publicDir, `logo-${width}w.png`);
    const finalPng = await sharp(trimmed)
      .resize({ width, withoutEnlargement: false })
      .png({ compressionLevel: 9 })
      .toBuffer();
    fs.writeFileSync(outPath, finalPng);
    console.log("Wrote", outPath);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
