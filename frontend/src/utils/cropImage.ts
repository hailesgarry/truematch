export type Area = { x: number; y: number; width: number; height: number };

export async function cropImageToBlob(
  file: File,
  cropArea: Area,
  rotation: number = 0,
  mime: string = "image/jpeg",
  quality: number = 0.92
): Promise<Blob> {
  const img = await loadImageFromFile(file);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D not supported");

  // Set canvas size to crop area
  canvas.width = Math.round(cropArea.width);
  canvas.height = Math.round(cropArea.height);

  // Draw with rotation if needed
  if (rotation) {
    ctx.save();
    // move to center, rotate, draw, restore
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(
      img,
      cropArea.x,
      cropArea.y,
      cropArea.width,
      cropArea.height,
      -canvas.width / 2,
      -canvas.height / 2,
      canvas.width,
      canvas.height
    );
    ctx.restore();
  } else {
    ctx.drawImage(
      img,
      cropArea.x,
      cropArea.y,
      cropArea.width,
      cropArea.height,
      0,
      0,
      canvas.width,
      canvas.height
    );
  }

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to create blob"));
      },
      mime,
      quality
    );
  });
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => reject(e);
    img.src = url;
  });
}
