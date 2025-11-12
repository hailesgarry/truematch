import React, { Suspense, useEffect, useState } from "react";
import { lazy } from "react";
import type {
  MediaUploadProps,
  MediaPreviewMeta,
} from "../../components/common/MediaUpload";
import type {
  VoiceRecorderHandle,
  VoiceRecorderProps,
} from "../../components/common/VoiceRecorder";
import { Microphone } from "@phosphor-icons/react";

const MediaUploadLazy = lazy(
  () => import("../../components/common/MediaUpload")
);
const MediaMessageLazy = lazy(async () => ({
  default: (await import("../../components/common/MediaUpload")).MediaMessage,
}));
const ReactionDrawerLazy = lazy(
  () => import("../../components/ReactionDrawer")
);
const LiveWaveformLazy = lazy(
  () => import("../../components/common/LiveWaveform")
);

export const OverlaySuspenseFallback: React.FC = () => (
  <div className="flex min-h-[40vh] items-center justify-center text-sm text-gray-500">
    Loading…
  </div>
);

export const MediaUploadPlaceholder: React.FC<MediaUploadProps> = (props) => {
  useEffect(() => {
    props.onRegisterTrigger?.(null);
    props.onBusyChange?.(false);
  }, [props.onRegisterTrigger, props.onBusyChange]);

  return (
    <div
      className={`hidden ${props.className ?? ""}`.trim()}
      data-media-upload-placeholder
    />
  );
};

export const DeferredMediaUpload: React.FC<MediaUploadProps> = (props) => (
  <Suspense fallback={<MediaUploadPlaceholder {...props} />}>
    <MediaUploadLazy {...props} />
  </Suspense>
);

export const MediaMessage: React.FC<
  React.ComponentProps<typeof MediaMessageLazy>
> = (props) => (
  <Suspense fallback={null}>
    <MediaMessageLazy {...props} />
  </Suspense>
);

export const ReactionDrawer: React.FC<
  React.ComponentProps<typeof ReactionDrawerLazy>
> = (props) => (
  <Suspense fallback={null}>
    <ReactionDrawerLazy {...props} />
  </Suspense>
);

export type VoiceRecorderModule =
  typeof import("../../components/common/VoiceRecorder");

export const DeferredVoiceRecorder = React.forwardRef<
  VoiceRecorderHandle,
  VoiceRecorderProps
>((props, ref) => {
  const [Recorder, setRecorder] = useState<
    VoiceRecorderModule["default"] | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    import("../../components/common/VoiceRecorder").then((mod) => {
      if (!cancelled) {
        setRecorder(() => mod.default);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!Recorder) {
    const wrapperClasses = `${
      props.className ?? ""
    } flex items-center justify-center`.trim();
    const buttonClasses = `${
      props.buttonClassName ?? ""
    } flex h-10 w-10 items-center justify-center rounded-full bg-gray-200 text-gray-500`.trim();
    return (
      <div className={wrapperClasses}>
        <button
          type="button"
          className={buttonClasses}
          disabled
          aria-label="Voice recorder loading"
        >
          <Microphone size={20} weight="fill" />
        </button>
      </div>
    );
  }

  return <Recorder ref={ref} {...props} />;
});
DeferredVoiceRecorder.displayName = "DeferredVoiceRecorder";

export const LazyLiveWaveform: React.FC<
  React.ComponentProps<typeof LiveWaveformLazy>
> = (props) => (
  <Suspense
    fallback={
      <span className="block truncate text-[11px] text-gray-400 select-none">
        Preparing waveform…
      </span>
    }
  >
    <LiveWaveformLazy {...props} />
  </Suspense>
);

export type { MediaUploadProps, MediaPreviewMeta };
