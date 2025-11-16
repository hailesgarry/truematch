import React from "react";
import { Play, Pause } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import LoadingSpinner from "../ui/LoadingSpinner";
import type WaveSurfer from "wavesurfer.js";
import {
  useAudioWaveformCache,
  setAudioWaveformCache,
  type AudioWaveformSnapshot,
} from "../../lib/audioWaveCache";

const msToSeconds = (ms?: number) =>
  typeof ms === "number" && ms > 0 ? ms / 1000 : 0;

const sanitizeSeconds = (value?: number | null) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

let activeWave: WaveSurfer | null = null;

interface AudioWaveProps {
  url: string;
  loading?: boolean;
  durationMs?: number;
  onDuration?: (durationMs: number) => void;
  backgroundColor?: string;
  trackColor?: string;
  progressColor?: string;
  buttonBgColor?: string;
  buttonIconColor?: string;
  timeColor?: string;
}

const AudioWave: React.FC<AudioWaveProps> = ({
  url,
  loading,
  durationMs,
  onDuration,
  backgroundColor,
  trackColor,
  progressColor,
  buttonBgColor,
  buttonIconColor,
  timeColor,
}) => {
  const queryClient = useQueryClient();
  const { data: cachedWaveform } = useAudioWaveformCache(url);
  const cachedWaveformRef = React.useRef<AudioWaveformSnapshot | undefined>(
    cachedWaveform ?? undefined
  );
  React.useEffect(() => {
    cachedWaveformRef.current = cachedWaveform ?? undefined;
  }, [cachedWaveform]);

  const hasCachedPeaks = React.useMemo(() => {
    return Boolean(cachedWaveform?.peaks && cachedWaveform.peaks.length);
  }, [cachedWaveform]);

  const containerBg = backgroundColor ?? "#ffffff";
  const staticTrackColor = trackColor ?? "#111827";
  const computedProgressColor = progressColor ?? "#ef4444";
  const computedButtonBg = buttonBgColor ?? "transparent";
  const computedButtonIcon = buttonIconColor ?? "#ef4444";
  const computedTimeColor = timeColor ?? "#4b5563"; // default gray-600

  const waveContainerRef = React.useRef<HTMLDivElement | null>(null);
  const waveRef = React.useRef<WaveSurfer | null>(null);
  const propDurationSeconds = React.useMemo(
    () => sanitizeSeconds(msToSeconds(durationMs)),
    [durationMs]
  );
  const [duration, setDuration] = React.useState(() => propDurationSeconds);
  const [current, setCurrent] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [waveReady, setWaveReady] = React.useState(false);
  const [hasStartedPlayback, setHasStartedPlayback] = React.useState(false);
  const reportedDurationRef = React.useRef<number | null>(null);
  const onDurationRef = React.useRef(onDuration);
  const durationRef = React.useRef(propDurationSeconds || 0);
  const minPxPerSecRef = React.useRef(12);
  const hasStartedPlaybackRef = React.useRef(false);

  React.useEffect(() => {
    onDurationRef.current = onDuration;
  }, [onDuration]);

  React.useEffect(() => {
    durationRef.current = duration || 0;
  }, [duration]);

  const fitWaveToContainer = React.useCallback((explicitDuration?: number) => {
    const wave = waveRef.current;
    const container = waveContainerRef.current;
    if (!wave || !container) return;
    const seconds = sanitizeSeconds(
      explicitDuration || wave.getDuration() || durationRef.current
    );
    if (!seconds) return;
    const width = container.clientWidth || 1;
    const desired = width / seconds;
    const clamped = Math.max(1.2, Math.min(20, desired));
    if (Math.abs(minPxPerSecRef.current - clamped) < 0.1) return;
    wave.setOptions({ minPxPerSec: clamped });
    minPxPerSecRef.current = clamped;
  }, []);

  const maybeReportDuration = React.useCallback((seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const handler = onDurationRef.current;
    if (!handler) return;
    const ms = Math.max(0, Math.round(seconds * 1000));
    if (!ms) return;
    if (reportedDurationRef.current === ms) return;
    reportedDurationRef.current = ms;
    handler(ms);
  }, []);

  React.useEffect(() => {
    const cachedDur = sanitizeSeconds(cachedWaveform?.duration);
    if (!cachedDur) return;
    setDuration((prev) => {
      if (prev && Math.abs(prev - cachedDur) < 0.01) return prev;
      return cachedDur;
    });
    maybeReportDuration(cachedDur);
  }, [cachedWaveform, maybeReportDuration]);

  React.useEffect(() => {
    if (propDurationSeconds == null) return;
    if (!propDurationSeconds) {
      setDuration(0);
      return;
    }
    setDuration((prev) => {
      if (prev && Math.abs(prev - propDurationSeconds) < 0.01) return prev;
      return propDurationSeconds;
    });
    maybeReportDuration(propDurationSeconds);
  }, [propDurationSeconds, maybeReportDuration]);

  const destroyWave = React.useCallback(() => {
    const wave = waveRef.current;
    if (!wave) return;
    wave.unAll();
    if (activeWave === wave) {
      try {
        wave.pause();
      } catch {}
      activeWave = null;
    }
    wave.destroy();
    if (waveContainerRef.current) {
      waveContainerRef.current.innerHTML = "";
    }
    waveRef.current = null;
  }, []);

  React.useEffect(() => {
    let disposed = false;

    const initWave = async () => {
      const container = waveContainerRef.current;
      if (!container || !url) {
        destroyWave();
        setWaveReady(false);
        setCurrent(0);
        setPlaying(false);
        setHasStartedPlayback(false);
        hasStartedPlaybackRef.current = false;
        return;
      }

      destroyWave();
      setWaveReady(false);
      setCurrent(0);
      setPlaying(false);
      setHasStartedPlayback(false);
      hasStartedPlaybackRef.current = false;
      reportedDurationRef.current = null;

      const cached = cachedWaveformRef.current;
      const cachedPeaks =
        cached?.peaks && cached.peaks.length ? cached.peaks : undefined;
      const cachedDurSeconds = sanitizeSeconds(cached?.duration);
      if (cachedPeaks) {
        setWaveReady(true);
      }

      try {
        const { default: WaveSurferLib } = await import("wavesurfer.js");
        if (disposed) return;

        const wave = WaveSurferLib.create({
          container,
          height: 22,
          waveColor: staticTrackColor,
          progressColor: computedProgressColor,
          cursorWidth: 0,
          barWidth: 3,
          barRadius: 999,
          barGap: 2,
          barAlign: "center" as any,
          normalize: true,
          dragToSeek: true,
          autoCenter: false,
          minPxPerSec: 12,
        });

        waveRef.current = wave;
        (wave as WaveSurfer & { setOptions: (opts: any) => void }).setOptions({
          barMinHeight: 4,
        });

        const handleReady = () => {
          const dur = sanitizeSeconds(
            wave.getDuration() || cachedDurSeconds || 0
          );
          if (dur) {
            setDuration((prev) => {
              if (prev && Math.abs(prev - dur) < 0.01) return prev;
              return dur;
            });
            maybeReportDuration(dur);
            fitWaveToContainer(dur);
          }
          setWaveReady(true);

          if (!url) return;
          const existing = cachedWaveformRef.current;
          const shouldUpdatePeaks =
            !existing || !existing.peaks || existing.peaks.length === 0;
          const durationChanged =
            existing && dur && Math.abs((existing.duration ?? 0) - dur) > 0.01;
          if (shouldUpdatePeaks || durationChanged) {
            try {
              const exported = wave.exportPeaks({ precision: 2 });
              if (exported && exported.length) {
                setAudioWaveformCache(queryClient, url, {
                  peaks: exported,
                  duration: dur || wave.getDuration() || cachedDurSeconds || 0,
                });
              }
            } catch {}
          }
        };

        wave.on("ready", handleReady);
        wave.on("decode", handleReady);
        wave.on("timeupdate", (time) => {
          setCurrent(time);
        });
        wave.on("play", () => {
          setPlaying(true);
          if (!hasStartedPlaybackRef.current) {
            hasStartedPlaybackRef.current = true;
            setHasStartedPlayback(true);
            setCurrent(0);
          }
          if (activeWave && activeWave !== wave) {
            try {
              activeWave.pause();
            } catch {}
          }
          activeWave = wave;
        });
        wave.on("pause", () => {
          setPlaying(false);
          if (activeWave === wave) {
            activeWave = null;
          }
        });
        wave.on("finish", () => {
          const total = sanitizeSeconds(
            wave.getDuration() || durationRef.current
          );
          const resetPlaybackState = () => {
            hasStartedPlaybackRef.current = false;
            setHasStartedPlayback(false);
          };
          if (total) {
            setCurrent(total);
            requestAnimationFrame(() => {
              try {
                wave.seekTo(0);
              } catch {}
              setCurrent(0);
              resetPlaybackState();
            });
          } else {
            setCurrent(0);
            resetPlaybackState();
          }
          setPlaying(false);
          if (activeWave === wave) {
            activeWave = null;
          }
        });
        wave.on("seeking", (time) => {
          setCurrent(time);
        });
        wave.on("error", () => {
          setWaveReady(false);
        });

        const mediaSource = url;
        if (!mediaSource) {
          setWaveReady(false);
          return;
        }

        await wave.load(
          mediaSource,
          cachedPeaks as any,
          cachedDurSeconds || undefined
        );
      } catch {
        if (!disposed) {
          setWaveReady(false);
        }
      }
    };

    if (typeof window !== "undefined") {
      initWave();
    }

    return () => {
      disposed = true;
      destroyWave();
    };
  }, [url, destroyWave, fitWaveToContainer, maybeReportDuration, queryClient]);

  React.useEffect(() => {
    if (!propDurationSeconds) return;
    fitWaveToContainer(propDurationSeconds);
  }, [propDurationSeconds, fitWaveToContainer]);

  React.useEffect(() => {
    const container = waveContainerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      fitWaveToContainer();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [fitWaveToContainer]);

  const stopBubble = (e: any) => {
    try {
      if (e && typeof e.stopPropagation === "function") e.stopPropagation();
    } catch {}
  };

  const toggle = () => {
    if (loading) return;
    const wave = waveRef.current;
    if (!wave || (!waveReady && !hasCachedPeaks)) return;
    if (wave.isPlaying()) {
      wave.pause();
    } else {
      if (activeWave && activeWave !== wave) {
        try {
          activeWave.pause();
        } catch {}
      }
      const playResult = wave.play() as
        | void
        | Promise<void>
        | PromiseLike<void>
        | undefined;
      if (
        playResult &&
        typeof (playResult as Promise<void>).catch === "function"
      ) {
        (playResult as Promise<void>).catch(() => {});
      }
    }
  };

  const onKeySeek = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (loading) return;
    const wave = waveRef.current;
    if (!wave || (!waveReady && !hasCachedPeaks)) return;
    const total = sanitizeSeconds(wave.getDuration() || durationRef.current);
    if (!total) return;
    const currentTime = wave.getCurrentTime();
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      const next = Math.max(0, currentTime - 5);
      wave.seekTo(next / total);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      const next = Math.min(total, currentTime + 5);
      wave.seekTo(next / total);
    } else if (e.key === "Home") {
      e.preventDefault();
      wave.seekTo(0);
    } else if (e.key === "End") {
      e.preventDefault();
      wave.seekTo(1);
    }
  };

  const fmt = (t: number) => {
    if (!isFinite(t) || t <= 0) return "0:00";
    const s = Math.floor(t);
    const m = Math.floor(s / 60)
      .toString()
      .padStart(1, "0");
    const ss = (s % 60).toString().padStart(2, "0");
    return `${m}:${ss}`;
  };

  let effectiveDuration = sanitizeSeconds(duration);
  if (!effectiveDuration && propDurationSeconds) {
    effectiveDuration = propDurationSeconds;
  }
  if (!effectiveDuration && waveRef.current) {
    effectiveDuration = sanitizeSeconds(
      waveRef.current.getDuration() || durationRef.current
    );
  }

  const safeCurrent = effectiveDuration
    ? Math.min(current, effectiveDuration)
    : current;

  const displayTotal = effectiveDuration || 0;

  const shouldShowElapsed =
    hasStartedPlayback || playing || (safeCurrent ?? 0) > 0.05;
  const displayTime = shouldShowElapsed ? safeCurrent : displayTotal;

  const showButtonSpinner = loading || (!waveReady && !hasCachedPeaks);

  const cycleRates = [0.75, 1, 1.25, 1.5, 2];
  const [rateIndex, setRateIndex] = React.useState(1); // default 1x
  const rate = cycleRates[rateIndex] ?? 1;
  React.useEffect(() => {
    const wave = waveRef.current as any;
    try {
      if (wave && typeof wave.setPlaybackRate === "function") {
        wave.setPlaybackRate(rate);
      }
    } catch {}
  }, [rate]);

  const onToggleRate = () => {
    setRateIndex((i) => (i + 1) % cycleRates.length);
  };

  const onWrapperKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === " " || e.key.toLowerCase() === "k") {
      e.preventDefault();
      toggle();
      return;
    }
  };

  return (
    <div
      className="flex w-full items-center gap-3"
      onKeyDown={onWrapperKeyDown}
      onPointerDown={stopBubble}
      onPointerMove={stopBubble}
      onPointerUp={stopBubble}
      onPointerCancel={stopBubble}
    >
      <button
        type="button"
        aria-label={
          showButtonSpinner ? "Loading audio" : playing ? "Pause" : "Play"
        }
        title={showButtonSpinner ? "Loading audio" : playing ? "Pause" : "Play"}
        onClick={(e) => {
          stopBubble(e);
          toggle();
        }}
        onMouseDown={stopBubble}
        onTouchStart={stopBubble}
        className={`flex items-center justify-center transition focus:outline-none ${
          showButtonSpinner ? "cursor-wait opacity-70" : ""
        }`}
        style={{
          backgroundColor: computedButtonBg,
          color: computedButtonIcon,
          touchAction: "manipulation",
        }}
        disabled={showButtonSpinner}
      >
        {showButtonSpinner ? (
          <LoadingSpinner size={18} label="Loading audio" />
        ) : playing ? (
          <Pause size={20} weight="fill" />
        ) : (
          <Play size={20} weight="fill" />
        )}
      </button>

      <div className="relative flex-1 min-w-0 select-none">
        <div
          ref={waveContainerRef}
          role="slider"
          aria-label="Voice note progress"
          aria-valuemin={0}
          aria-valuemax={effectiveDuration || 0}
          aria-valuenow={safeCurrent || 0}
          aria-busy={showButtonSpinner || undefined}
          tabIndex={0}
          onKeyDown={onKeySeek}
          className={`w-full overflow-hidden rounded-xl transition ${
            showButtonSpinner ? "cursor-wait" : "cursor-pointer"
          }`}
          style={{ background: containerBg, height: 22 }}
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`Playback speed ${rate}x`}
          title="Change speed"
          onClick={(e) => {
            stopBubble(e);
            onToggleRate();
          }}
          className="flex h-8 w-10 items-center justify-center rounded-md border bg-white text-xs font-medium text-gray-500 active:opacity-90"
          style={{ touchAction: "manipulation", borderColor: "#e2e8f0" }}
        >
          {rate.toFixed(2).replace(/\.00$/, "").replace(/0$/, "")}x
        </button>

        <div className="flex h-9 items-center justify-center px-2">
          <span
            className="text-xs tabular-nums select-none"
            style={{ color: computedTimeColor }}
          >
            {fmt(Math.max(0, displayTime))}
          </span>
        </div>
      </div>
    </div>
  );
};

export default AudioWave;
