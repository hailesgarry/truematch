import React from "react";

interface LiveWaveformProps {
  values: number[];
  paused?: boolean;
  className?: string;
  capacity?: number;
}

// Canvas waveform that mimics the playback WaveSurfer styling during recording.
const LiveWaveform: React.FC<LiveWaveformProps> = ({
  values,
  paused,
  className,
  capacity,
}) => {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const devicePixelRatioRef = React.useRef<number>(
    typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
  );

  React.useEffect(() => {
    const handle = () => {
      devicePixelRatioRef.current =
        typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    };
    if (typeof window !== "undefined") {
      window.addEventListener("resize", handle);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", handle);
      }
    };
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = devicePixelRatioRef.current;
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    const scaledWidth = Math.floor(width * dpr);
    const scaledHeight = Math.floor(height * dpr);

    if (canvas.width !== scaledWidth || canvas.height !== scaledHeight) {
      canvas.width = scaledWidth;
      canvas.height = scaledHeight;
    }

    const history = values.map((v) => Math.max(0, Math.min(1, v)));
    const historyLength = history.length;
    const maxSamples = capacity && capacity > 0 ? capacity : historyLength || 1;

    const barWidthPx = 3;
    const barGapPx = 2.5;
    const approxBarSpan = barWidthPx + barGapPx;
    const totalBars = Math.max(12, Math.floor(width / approxBarSpan));
    const effectiveSamples = Math.min(totalBars, historyLength, maxSamples);
    const startIndex = Math.max(0, historyLength - effectiveSamples);

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const midY = height / 2;
    ctx.fillStyle = paused ? "#e5e7eb" : "#e5e7eb";
    ctx.globalAlpha = 0.65;
    ctx.fillRect(0, midY - 0.5, width, 1);
    ctx.globalAlpha = 1;

    const baseColor = "#d1d5db";
    const progressColor = paused ? "#6b7280" : "#1f2937";
    ctx.lineCap = "round";

    const padding = height * 0.12;
    const usableHeight = Math.max(4, height - padding * 2);
    const baseDotHeight = Math.max(2, height * 0.08);
    const spacing = width / totalBars;
    const barWidth = Math.max(2, spacing * 0.55);
    ctx.lineWidth = barWidth;

    const recordedOffset = totalBars - effectiveSamples;

    for (let i = 0; i < totalBars; i++) {
      const recordedIndex = i - recordedOffset;
      const isRecorded = recordedIndex >= 0 && recordedIndex < effectiveSamples;
      const historyIndex = isRecorded
        ? Math.min(historyLength - 1, startIndex + recordedIndex)
        : -1;
      const magnitude =
        isRecorded && historyIndex >= 0
          ? Math.pow(Math.min(1, history[historyIndex] ?? 0), 0.7)
          : 0;
      const x = i * spacing + spacing / 2;

      // Base waveform (light gray) mirrors the playback track background.
      ctx.fillStyle = baseColor;
      ctx.beginPath();
      ctx.ellipse(x, midY, barWidth / 2, baseDotHeight / 2, 0, 0, Math.PI * 2);
      ctx.fill();

      if (isRecorded) {
        // Progress overlay in the same color the playback waveform uses.
        ctx.strokeStyle = progressColor;
        const barHeight = Math.max(baseDotHeight, magnitude * usableHeight);
        ctx.beginPath();
        ctx.moveTo(x, midY - barHeight / 2);
        ctx.lineTo(x, midY + barHeight / 2);
        ctx.stroke();
      }
    }

    ctx.restore();
  }, [values, paused, capacity]);

  return <canvas ref={canvasRef} className={`h-8 w-full ${className || ""}`} />;
};

export default LiveWaveform;
