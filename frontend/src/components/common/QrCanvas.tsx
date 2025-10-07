import React from "react";

// Lazy-load qrcode to keep initial bundle small
let QR: any = null;
async function ensureLib() {
  if (QR) return QR;
  const mod = await import("qrcode");
  QR = mod;
  return QR;
}

export type QrCanvasProps = {
  text: string;
  size?: number; // pixels
  className?: string;
  onReady?: () => void;
};

const QrCanvas: React.FC<QrCanvasProps> = ({
  text,
  size = 160,
  className = "",
  onReady,
}) => {
  const ref = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const lib = await ensureLib();
      if (cancelled) return;
      const canvas = ref.current;
      if (!canvas) return;
      try {
        await lib.toCanvas(canvas, text, {
          width: size,
          margin: 1,
          color: {
            dark: "#1f2937", // gray-800
            light: "#ffffff",
          },
        });
        onReady?.();
      } catch (e) {
        // noop
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [text, size, onReady]);

  return <canvas ref={ref} width={size} height={size} className={className} />;
};

export default QrCanvas;
