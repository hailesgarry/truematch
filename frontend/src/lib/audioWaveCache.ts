import { useMemo } from "react";
import {
  useQuery,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

export type AudioWaveformSnapshot = {
  peaks: Array<number[]>;
  duration: number;
};

const AUDIO_WAVEFORM_SCOPE = "audioWaveform" as const;

export const audioWaveformKey = (url: string): QueryKey => [
  AUDIO_WAVEFORM_SCOPE,
  url,
];

export const useAudioWaveformCache = (url?: string | null) => {
  const key = useMemo<QueryKey>(() => {
    return url ? audioWaveformKey(url) : [AUDIO_WAVEFORM_SCOPE, "__idle__"];
  }, [url]);

  return useQuery<AudioWaveformSnapshot>({
    queryKey: key,
    queryFn: async () => {
      throw new Error("Audio waveforms are populated via AudioWave component");
    },
    enabled: false,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 24,
  });
};

export const setAudioWaveformCache = (
  queryClient: QueryClient,
  url: string,
  data: AudioWaveformSnapshot
) => {
  queryClient.setQueryData(audioWaveformKey(url), data);
};
