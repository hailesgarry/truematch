import { useCallback } from "react";

export type ComposerRecordingPersisted = never;

export type ComposerRecordingPreview = {
  url: string;
  blob: Blob;
  durationMs: number;
  mimeType: string;
  updatedAt: number;
};

type PersistPayload = {
  blob: Blob;
  durationMs: number;
  mimeType: string;
};

export function useComposerRecordingCache(
  _scopeKey: string | null | undefined
) {
  const persistPreview = useCallback(async (_payload: PersistPayload) => {
    /* audio persistence disabled */
  }, []);

  const clearPreview = useCallback(async () => {
    /* audio persistence disabled */
  }, []);

  return {
    preview: null as ComposerRecordingPreview | null,
    persistPreview,
    clearPreview,
  } as const;
}
