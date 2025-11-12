import React from "react";
import LogoMark from "./LogoMark";

type Format = "svg" | "png" | "jpeg";

interface LogoDownloadProps {
  size?: number; // output size in px for raster formats
  filenameBase?: string;
}

const LOGO_BACKGROUND = "#ffffff";

// Utility to serialize the SVG element to a string
function svgElementToString(element: SVGSVGElement): string {
  const serializer = new XMLSerializer();
  let source = serializer.serializeToString(element);
  // add xml declaration
  if (!source.match(/^<\?xml/)) {
    source = `<?xml version="1.0" standalone="no"?>\n${source}`;
  }
  return source;
}

async function svgToRasterDataURL(
  svgString: string,
  size: number,
  format: Exclude<Format, "svg">
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const svgBlob = new Blob([svgString], {
      type: "image/svg+xml;charset=utf-8",
    });
    const url = URL.createObjectURL(svgBlob);
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas 2D not supported"));
        // Only fill for formats without alpha support (e.g., JPEG)
        if (format === "jpeg") {
          ctx.fillStyle = LOGO_BACKGROUND;
          ctx.fillRect(0, 0, size, size);
        } else {
          ctx.clearRect(0, 0, size, size);
        }
        ctx.drawImage(img, 0, 0, size, size);
        const dataUrl = canvas.toDataURL(`image/${format}`);
        URL.revokeObjectURL(url);
        resolve(dataUrl);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = (e) => reject(e);
    img.src = url;
  });
}

const LogoDownload: React.FC<LogoDownloadProps> = ({
  size = 512,
  filenameBase = "truematch-logo",
}) => {
  const svgRef = React.useRef<SVGSVGElement | null>(null);

  const download = async (format: Format) => {
    if (!svgRef.current) return;
    const svgString = svgElementToString(svgRef.current);
    let href: string;
    let filename = `${filenameBase}.${format}`;
    if (format === "svg") {
      const blob = new Blob([svgString], {
        type: "image/svg+xml;charset=utf-8",
      });
      href = URL.createObjectURL(blob);
    } else {
      href = await svgToRasterDataURL(svgString, size, format);
    }
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (format === "svg") URL.revokeObjectURL(href);
  };

  return (
    <div className="flex flex-col gap-3 items-start">
      <div className="flex items-center gap-3">
        {/* Hidden offscreen clone to serialize */}
        <div style={{ position: "absolute", left: -9999, top: -9999 }}>
          <LogoMark
            size={size}
            withBackground={false}
            // Capture the underlying SVG element via ref forwarding
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            {...({ ref: svgRef } as any)}
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-1.5 rounded-md bg-slate-800 text-white text-sm"
            onClick={() => download("svg")}
          >
            Download SVG
          </button>
          <button
            className="px-3 py-1.5 rounded-md bg-slate-800 text-white text-sm"
            onClick={() => download("png")}
          >
            Download PNG
          </button>
          <button
            className="px-3 py-1.5 rounded-md bg-slate-800 text-white text-sm"
            onClick={() => download("jpeg")}
          >
            Download JPEG
          </button>
        </div>
      </div>
      <div className="text-xs text-slate-500">
        Exports square {size}×{size}. PNG keeps transparency; JPEG adds a white
        backdrop.
      </div>
    </div>
  );
};

export default LogoDownload;
