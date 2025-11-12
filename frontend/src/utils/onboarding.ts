import { uploadAvatar } from "../services/api";
import { getDiceBearAvatar } from "./avatarGen";

export interface ResolveAvatarResult {
  url: string | null;
  uploaded: boolean;
  error?: string;
}

// Attempts to upload the given file; if none or upload fails, falls back to a generated Dicebear avatar.
export async function resolveAvatarUrl(
  username: string,
  fileToUpload: File | null,
  onProgress?: (progress: number) => void
): Promise<ResolveAvatarResult> {
  let uploaded = false;
  let url: string | null = null;
  let error: string | undefined;
  const name = (username || "").trim();

  if (fileToUpload) {
    try {
      const res = await uploadAvatar(fileToUpload, onProgress);
      url = res.url || null;
      uploaded = !!url;
    } catch (e: any) {
      error = e?.message || "Upload failed";
    }
  }

  if (!url) {
    try {
      // Generate SVG and rasterize to PNG before returning so backend upload will work
      const svgUrl = await getDiceBearAvatar(name);
      // Convert to PNG data URL via canvas
      const toPng = async (svg: string): Promise<string> => {
        return new Promise((resolve) => {
          try {
            const img = new Image();
            img.onload = () => {
              try {
                const s = 256;
                const canvas = document.createElement("canvas");
                canvas.width = s;
                canvas.height = s;
                const ctx = canvas.getContext("2d");
                if (!ctx) return resolve(svg);
                ctx.clearRect(0, 0, s, s);
                const scale = Math.min(s / img.width, s / img.height);
                const w = img.width * scale;
                const h = img.height * scale;
                const dx = (s - w) / 2;
                const dy = (s - h) / 2;
                ctx.drawImage(img, dx, dy, w, h);
                resolve(canvas.toDataURL("image/png", 0.92));
              } catch {
                resolve(svg);
              }
            };
            img.onerror = () => resolve(svg);
            img.src = svg;
          } catch {
            resolve(svg);
          }
        });
      };
      url = await toPng(svgUrl);
    } catch {
      // ignore
    }
  }

  return { url, uploaded, error };
}

// applyDefaultBubbleColor was removed as bubbles now use a unified gray color.
