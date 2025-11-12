import React from "react";
import { Microphone } from "@phosphor-icons/react";

export const RECORDING_WAVEFORM_CAP = 480;

export type VoiceRecorderState = "idle" | "recording" | "paused" | "stopped";

export interface VoiceRecorderProps {
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  // Called when recording has been stopped and an audio File is ready
  onComplete: (
    file: File,
    meta: { durationMs: number }
  ) => void | Promise<void>;
  // Optional render override for the idle trigger button
  renderTrigger?: (state: VoiceRecorderState) => React.ReactNode;
  // Notify parent when state changes (useful to rearrange UI elsewhere)
  onStateChange?: (
    state: VoiceRecorderState,
    meta?: { durationMs: number }
  ) => void;
  // Optional: tick callback with current duration while recording
  onTick?: (durationMs: number) => void;
  // Optional: live waveform samples while recording
  onWaveform?: (values: number[]) => void;
  // Optional: preview callback emitted when a paused recording can be reviewed
  onPreview?: (
    preview: {
      url: string;
      durationMs: number;
      blob: Blob;
      mimeType: string;
    } | null
  ) => void;
}

export interface VoiceRecorderHandle {
  stop: () => void;
  cancel: () => void;
  pause: () => void;
  resume: () => void;
  start: () => void;
}

const VoiceRecorder = React.forwardRef<VoiceRecorderHandle, VoiceRecorderProps>(
  function VoiceRecorder(
    {
      disabled,
      className,
      buttonClassName,
      onComplete,
      renderTrigger,
      onStateChange,
      onTick,
      onWaveform,
      onPreview,
    },
    ref
  ) {
    const [state, setState] = React.useState<VoiceRecorderState>("idle");
    const [err, setErr] = React.useState<string | null>(null);
    // we track duration externally via onTick; no local UI depends on it
    const chunksRef = React.useRef<Blob[]>([]);
    const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
    const startTimeRef = React.useRef<number>(0);
    const timerRef = React.useRef<number | null>(null);
    const pausedAccumRef = React.useRef<number>(0);
    const audioCtxRef = React.useRef<AudioContext | null>(null);
    const analyserRef = React.useRef<AnalyserNode | null>(null);
    const analyserSourceRef = React.useRef<MediaStreamAudioSourceNode | null>(
      null
    );
    const analyserBufferRef = React.useRef<Float32Array | null>(null);
    const analyserFrameRef = React.useRef<number | null>(null);
    const lastWaveEmitRef = React.useRef<number>(0);
    const waveformHistoryRef = React.useRef<number[]>([]);
    const waveformCbRef = React.useRef<
      VoiceRecorderProps["onWaveform"] | undefined
    >(undefined);
    const previewUrlRef = React.useRef<string | null>(null);
    const previewCbRef = React.useRef<
      VoiceRecorderProps["onPreview"] | undefined
    >(undefined);
    const stopHandlerRef = React.useRef<(() => void) | null>(null);
    const ignoreStopRef = React.useRef(false);

    React.useEffect(() => {
      waveformCbRef.current = onWaveform;
    }, [onWaveform]);

    React.useEffect(() => {
      previewCbRef.current = onPreview;
    }, [onPreview]);

    const emitWaveform = React.useCallback((values: number[]) => {
      const cb = waveformCbRef.current;
      if (!cb) return;
      try {
        cb(values);
      } catch {}
    }, []);

    const clearPreviewUrl = React.useCallback(() => {
      const prev = previewUrlRef.current;
      if (prev) {
        try {
          URL.revokeObjectURL(prev);
        } catch {}
        previewUrlRef.current = null;
      }
    }, []);

    const emitPreview = React.useCallback(
      (
        preview: {
          url: string;
          durationMs: number;
          blob: Blob;
          mimeType: string;
        } | null
      ) => {
        const cb = previewCbRef.current;
        if (!cb) return;
        try {
          cb(preview);
        } catch {}
      },
      []
    );

    const publishPreview = React.useCallback(
      (mimeType: string, durationMs: number) => {
        if (!previewCbRef.current) return;
        if (!chunksRef.current.length) {
          clearPreviewUrl();
          emitPreview(null);
          return;
        }
        try {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          if (!blob.size) {
            clearPreviewUrl();
            emitPreview(null);
            return;
          }
          clearPreviewUrl();
          const url = URL.createObjectURL(blob);
          previewUrlRef.current = url;
          emitPreview({ url, durationMs, blob, mimeType });
        } catch {
          clearPreviewUrl();
          emitPreview(null);
        }
      },
      [clearPreviewUrl, emitPreview]
    );

    const stopWaveMonitor = React.useCallback(() => {
      if (analyserFrameRef.current !== null) {
        cancelAnimationFrame(analyserFrameRef.current);
        analyserFrameRef.current = null;
      }
    }, []);

    const cleanupAudioGraph = React.useCallback(() => {
      stopWaveMonitor();
      analyserRef.current = null;
      analyserBufferRef.current = null;
      lastWaveEmitRef.current = 0;
      waveformHistoryRef.current = [];
      const src = analyserSourceRef.current;
      if (src) {
        try {
          src.disconnect();
        } catch {}
      }
      analyserSourceRef.current = null;
      const ctx = audioCtxRef.current;
      audioCtxRef.current = null;
      if (ctx) {
        try {
          ctx.close();
        } catch {}
      }
      emitWaveform([]);
    }, [emitWaveform, stopWaveMonitor]);

    const startWaveMonitor = React.useCallback(() => {
      stopWaveMonitor();
      const analyser = analyserRef.current;
      const buffer = analyserBufferRef.current;
      if (!analyser || !buffer) return;

      const tick = () => {
        const node = analyserRef.current;
        const buf = analyserBufferRef.current;
        if (!node || !buf) return;
        node.getFloatTimeDomainData(buf as any);

        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
          const sample = buf[i];
          if (!Number.isFinite(sample)) continue;
          const magnitude = Math.abs(sample);
          if (magnitude > peak) peak = magnitude;
        }

        // Apply light smoothing so bars feel responsive but not jittery.
        const history = waveformHistoryRef.current;
        const eased = Math.min(1, peak ** 0.9);
        history.push(eased);
        if (history.length > RECORDING_WAVEFORM_CAP) {
          history.splice(0, history.length - RECORDING_WAVEFORM_CAP);
        }

        const now = Date.now();
        if (now - lastWaveEmitRef.current >= 50) {
          lastWaveEmitRef.current = now;
          emitWaveform([...history]);
        }
        analyserFrameRef.current = requestAnimationFrame(tick);
      };

      tick();
    }, [emitWaveform, stopWaveMonitor]);

    const clearTimer = () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };

    const reset = React.useCallback(() => {
      clearTimer();
      cleanupAudioGraph();
      clearPreviewUrl();
      emitPreview(null);
      const recorder = mediaRecorderRef.current;
      if (recorder) {
        try {
          recorder.removeEventListener("dataavailable", onDataAvailable);
        } catch {}
        const stopHandler = stopHandlerRef.current;
        if (stopHandler) {
          try {
            recorder.removeEventListener("stop", stopHandler);
          } catch {}
        }
        try {
          recorder.stream.getTracks().forEach((t) => t.stop());
        } catch {}
      }
      mediaRecorderRef.current = null;
      chunksRef.current = [];
      startTimeRef.current = 0;
      pausedAccumRef.current = 0;
      stopHandlerRef.current = null;
      ignoreStopRef.current = false;
      setState("idle");
      onStateChange?.("idle");
    }, [cleanupAudioGraph, clearPreviewUrl, emitPreview, onStateChange]);

    const onDataAvailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    const stopRecording = React.useCallback(() => {
      const mr = mediaRecorderRef.current;
      if (mr && mr.state !== "inactive") {
        stopWaveMonitor();
        mr.stop();
      }
    }, [stopWaveMonitor]);

    const startRecording = React.useCallback(async () => {
      setErr(null);
      clearPreviewUrl();
      emitPreview(null);
      waveformHistoryRef.current = [];
      emitWaveform([]);
      ignoreStopRef.current = false;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        if (onWaveform) {
          cleanupAudioGraph();
          const AudioCtx =
            typeof window !== "undefined"
              ? ((window.AudioContext || (window as any).webkitAudioContext) as
                  | typeof AudioContext
                  | undefined)
              : undefined;
          if (AudioCtx) {
            try {
              const ctx = new AudioCtx();
              audioCtxRef.current = ctx;
              const src = ctx.createMediaStreamSource(stream);
              analyserSourceRef.current = src;
              const analyser = ctx.createAnalyser();
              analyser.fftSize = 1024;
              analyser.smoothingTimeConstant = 0.85;
              src.connect(analyser);
              analyserRef.current = analyser;
              analyserBufferRef.current = new Float32Array(analyser.fftSize);
              try {
                await ctx.resume();
              } catch {}
              startWaveMonitor();
            } catch {
              cleanupAudioGraph();
            }
          } else {
            emitWaveform([]);
          }
        }
        const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
          ? "audio/ogg;codecs=opus"
          : "audio/webm";
        const mr = new MediaRecorder(stream, { mimeType: mime });
        mediaRecorderRef.current = mr;
        chunksRef.current = [];
        startTimeRef.current = Date.now();
        pausedAccumRef.current = 0;
        setState("recording");
        onStateChange?.("recording");
        timerRef.current = window.setInterval(() => {
          const d =
            pausedAccumRef.current + (Date.now() - startTimeRef.current);
          try {
            onTick?.(d);
          } catch {}
        }, 250) as unknown as number;
        mr.addEventListener("dataavailable", onDataAvailable);
        const handleStop = async () => {
          mr.removeEventListener("dataavailable", onDataAvailable);
          if (stopHandlerRef.current) {
            try {
              mr.removeEventListener("stop", stopHandlerRef.current);
            } catch {}
          }
          stopHandlerRef.current = null;
          if (ignoreStopRef.current) {
            ignoreStopRef.current = false;
            return;
          }
          clearPreviewUrl();
          emitPreview(null);
          cleanupAudioGraph();
          clearTimer();
          const blob = new Blob(chunksRef.current, { type: mr.mimeType });
          const ext = mr.mimeType.includes("ogg") ? "ogg" : "webm";
          const file = new File([blob], `voice-${Date.now()}.${ext}`, {
            type: mr.mimeType,
          });
          const dur =
            pausedAccumRef.current + (Date.now() - startTimeRef.current);
          // Clean up tracks
          mr.stream.getTracks().forEach((t) => t.stop());
          mediaRecorderRef.current = null;
          chunksRef.current = [];
          startTimeRef.current = 0;
          pausedAccumRef.current = 0;
          setState("stopped");
          onStateChange?.("stopped", { durationMs: dur });
          try {
            await onComplete(file, { durationMs: dur });
          } finally {
            // Always reset to idle so component is ready again
            setTimeout(reset, 0);
          }
        };
        stopHandlerRef.current = handleStop;
        mr.addEventListener("stop", handleStop);
        mr.start(100); // timeslice to get dataavailable periodically
      } catch (e: any) {
        setErr(e?.message || "Microphone permission denied");
        reset();
      }
    }, [
      cleanupAudioGraph,
      clearPreviewUrl,
      emitWaveform,
      emitPreview,
      onComplete,
      onStateChange,
      onTick,
      onWaveform,
      reset,
      startWaveMonitor,
    ]);

    const resetOnUnmountRef = React.useRef(reset);
    React.useEffect(() => {
      resetOnUnmountRef.current = reset;
    }, [reset]);
    React.useEffect(() => () => resetOnUnmountRef.current(), []);

    // Expose imperative methods to the parent
    React.useImperativeHandle(
      ref,
      () => ({
        stop: () => stopRecording(),
        cancel: () => {
          const mr = mediaRecorderRef.current;
          if (mr && mr.state !== "inactive") {
            ignoreStopRef.current = true;
            try {
              mr.removeEventListener("dataavailable", onDataAvailable);
            } catch {}
            const stopHandler = stopHandlerRef.current;
            if (stopHandler) {
              try {
                mr.removeEventListener("stop", stopHandler);
              } catch {}
            }
            stopHandlerRef.current = null;
            try {
              mr.stop();
            } catch {}
          }
          reset();
        },
        pause: () => {
          const mr = mediaRecorderRef.current;
          if (mr && mr.state === "recording") {
            mr.pause();
            stopWaveMonitor();
            // accumulate elapsed so far
            pausedAccumRef.current += Date.now() - startTimeRef.current;
            clearTimer();
            setState("paused");
            onStateChange?.("paused");
            mr.requestData?.();
            const mime = mr.mimeType;
            const duration = pausedAccumRef.current;
            setTimeout(() => {
              const currentRecorder = mediaRecorderRef.current;
              if (!currentRecorder || currentRecorder.state !== "paused") {
                return;
              }
              publishPreview(mime, duration);
            }, 0);
          }
        },
        resume: () => {
          const mr = mediaRecorderRef.current;
          if (mr && mr.state === "paused") {
            clearPreviewUrl();
            emitPreview(null);
            mr.resume();
            setState("recording");
            onStateChange?.("recording");
            startTimeRef.current = Date.now();
            timerRef.current = window.setInterval(() => {
              const d =
                pausedAccumRef.current + (Date.now() - startTimeRef.current);
              try {
                onTick?.(d);
              } catch {}
            }, 250) as unknown as number;
            startWaveMonitor();
          }
        },
        start: () => {
          if (
            mediaRecorderRef.current &&
            mediaRecorderRef.current.state !== "inactive"
          ) {
            return;
          }
          void startRecording();
        },
      }),
      [
        clearPreviewUrl,
        emitPreview,
        onStateChange,
        onTick,
        publishPreview,
        reset,
        startRecording,
        startWaveMonitor,
        stopRecording,
        stopWaveMonitor,
      ]
    );

    const trigger = renderTrigger ? (
      renderTrigger(state)
    ) : (
      <button
        type="button"
        aria-label={"Start voice recording"}
        title={"Voice note"}
        className={`pointer-events-auto text-red-500 transition ${
          buttonClassName || ""
        } ${state !== "idle" ? "opacity-60 cursor-not-allowed" : ""}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={state === "idle" ? startRecording : undefined}
        disabled={disabled || state !== "idle"}
      >
        <Microphone size={22} weight="fill" />
      </button>
    );

    return (
      <div className={className || ""}>
        {/* External inline timer/trash intentionally removed.
            The main input renders recording UI; this component only shows the Mic/Stop trigger. */}
        {trigger}
        {err && (
          <span className="ml-1 text-xs text-red-600" role="alert">
            {err}
          </span>
        )}
      </div>
    );
  }
);

export default VoiceRecorder;
