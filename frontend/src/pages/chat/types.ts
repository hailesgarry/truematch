import type { Message } from "../../types";

export type IdleOptions = {
  timeout?: number;
  fallbackDelay?: number;
};

export type SuppressedWindow = {
  start: number;
  end: number;
};

export type AnimatedSources = {
  gif: string;
  mp4?: string;
  webm?: string;
  preview?: string;
};

export type RecorderPreview = {
  url: string;
  durationMs: number;
  mimeType?: string;
};

export type RecordingSnapshot = {
  blob: Blob;
  durationMs: number;
  mimeType: string;
  url?: string | null;
  urlOwned?: boolean;
};

export type MessageLike = Partial<Message> & Record<string, any>;
