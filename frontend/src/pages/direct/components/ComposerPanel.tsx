import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pause, Microphone, X } from "@phosphor-icons/react";
import TextComposer from "../../../components/chat/TextComposer";
import MediaUpload from "../../../components/common/MediaUpload";
import VoiceRecorder, {
  RECORDING_WAVEFORM_CAP,
  type VoiceRecorderHandle,
} from "../../../components/common/VoiceRecorder";
import LiveWaveform from "../../../components/common/LiveWaveform";
import AudioWave from "../../../components/common/AudioWave";
import {
  EditingPreview,
  ReplyingPreview,
} from "../../../components/chat/ComposerPreview";
import LinkPreviewCard, {
  LinkPreviewSkeleton,
} from "../../../components/chat/LinkPreviewCard";
import { useComposerRecordingCache } from "../../../hooks/useComposerRecordingCache";
import { mergeAudioBlobs } from "../../../utils/audioMerge";
import { uploadChatMedia } from "../../../services/api";
import { useMessageStore } from "../../../stores/messageStore";
import { useSocketStore } from "../../../stores/socketStore";
import type { Message, ToastTone } from "../../../types";
import type { UseQueryResult } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import {
  audioWaveformKey,
  setAudioWaveformCache,
  type AudioWaveformSnapshot,
} from "../../../lib/audioWaveCache";
import type { LinkPreviewData } from "../../../hooks/useLinkPreview";

type AnimatedMediaProps = {
  url: string;
  large?: boolean;
  mediaSources?: {
    mp4?: string;
    webm?: string;
    gif?: string;
    preview?: string;
  };
};

type RecorderPreview = {
  url: string;
  durationMs: number;
  mimeType?: string;
};

type RecordingSnapshot = {
  blob: Blob;
  durationMs: number;
  mimeType: string;
  url?: string | null;
  urlOwned?: boolean;
};

interface ComposerPanelProps {
  scopeKey: string | null | undefined;
  messageInput: string;
  setMessageInput: (value: string, cursorPos?: number) => void;
  setCursorPos: (pos: number) => void;
  inputRef:
    | React.RefObject<HTMLTextAreaElement | null>
    | React.MutableRefObject<HTMLTextAreaElement | null>;
  isConnected: boolean;
  dmId: string | null;
  username: string | null;
  editingMessage: Message | null;
  onCancelEditing: () => void;
  replyTarget: Message | null;
  onCancelReplying: () => void;
  sheetOpen: boolean;
  onCloseSheet: () => void;
  setEmojiOpen: (open: boolean) => void;
  setGifOpen: (open: boolean) => void;
  composerPreviewActiveUrl: string | null;
  composerPreviewQuery: UseQueryResult<LinkPreviewData | null, unknown>;
  onDismissLinkPreview: (url: string) => void;
  onSendTextMessage: () => void;
  sendDirectMessage: (payload: any, reply: any, meta?: any) => void;
  clearReplyTarget: () => void;
  AnimatedMedia: React.ComponentType<AnimatedMediaProps>;
  isGifUrl: (url: string) => boolean;
  isEmojiOnly: (text?: string) => boolean;
  isVideoUrl: (url: string) => boolean;
  showToast: (message: string, duration?: number, tone?: ToastTone) => void;
}

const ComposerPanel: React.FC<ComposerPanelProps> = ({
  scopeKey,
  messageInput,
  setMessageInput,
  setCursorPos,
  inputRef,
  isConnected,
  dmId,
  username,
  editingMessage,
  onCancelEditing,
  replyTarget,
  onCancelReplying,
  sheetOpen,
  onCloseSheet,
  setEmojiOpen,
  setGifOpen,
  composerPreviewActiveUrl,
  composerPreviewQuery,
  onDismissLinkPreview,
  onSendTextMessage,
  sendDirectMessage,
  clearReplyTarget,
  AnimatedMedia,
  isGifUrl,
  isEmojiOnly,
  isVideoUrl,
  showToast,
}) => {
  const voiceRef = useRef<VoiceRecorderHandle | null>(null);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [recordMs, setRecordMs] = useState(0);
  const [waveformValues, setWaveformValues] = useState<number[]>([]);
  const [preview, setPreview] = useState<RecorderPreview | null>(null);
  const [recorderLive, setRecorderLive] = useState(false);
  const previewBlobRef = useRef<{
    blob: Blob;
    mimeType: string;
    durationMs: number;
  } | null>(null);
  const appendBaseRef = useRef<Blob | null>(null);
  const appendDurationRef = useRef(0);
  const appendMimeRef = useRef<string | null>(null);
  const previewUrlRef = useRef<{ url: string; owned: boolean } | null>(null);
  const elapsedBaseRef = useRef(0);
  const sessionBaseRef = useRef(0);
  const latestRecorderStateRef = useRef({
    live: false,
    recording: false,
    paused: false,
  });
  const optimisticAudioUrls = useRef<Map<string, string>>(new Map());
  const queryClient = useQueryClient();
  const notifyTyping = useSocketStore((s) => s.notifyDmTyping);
  const typingSignalRef = useRef<{
    timeoutId: number | null;
    lastSentAt: number;
    active: boolean;
    dmId: string | null;
  }>({
    timeoutId: null,
    lastSentAt: 0,
    active: false,
    dmId: null,
  });

  const sendTypingSignal = useCallback(
    (targetDmId: string | null, typing: boolean) => {
      if (!targetDmId) return;
      notifyTyping(targetDmId, typing);
    },
    [notifyTyping]
  );

  const ensureStopTyping = useCallback(
    (targetDmId?: string | null) => {
      const state = typingSignalRef.current;
      if (state.timeoutId != null) {
        clearTimeout(state.timeoutId);
        state.timeoutId = null;
      }
      const effectiveTarget =
        targetDmId !== undefined ? targetDmId : state.dmId;
      if (state.active && effectiveTarget) {
        sendTypingSignal(effectiveTarget, false);
      }
      state.active = false;
      state.lastSentAt = 0;
      if (targetDmId !== undefined) {
        state.dmId = targetDmId;
      }
    },
    [sendTypingSignal]
  );

  const {
    preview: cachedRecording,
    persistPreview,
    clearPreview,
  } = useComposerRecordingCache(scopeKey);

  const sendDmVoiceNote = useCallback(
    async (
      source: Blob | File,
      durationMs: number,
      mimeType?: string
    ): Promise<boolean> => {
      if (!username || !dmId) return false;
      if (!Number.isFinite(durationMs) || durationMs <= 0) return false;

      const effectiveMime =
        mimeType && mimeType.length ? mimeType : source.type || "audio/webm";
      const ext = effectiveMime.includes("ogg")
        ? "ogg"
        : effectiveMime.includes("wav")
        ? "wav"
        : "webm";
      const file =
        source instanceof File
          ? source
          : new File([source], `voice-${Date.now()}.${ext}`, {
              type: effectiveMime,
            });

      const localId = `loc-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const objectUrl = URL.createObjectURL(file);
      optimisticAudioUrls.current.set(localId, objectUrl);

      const replySnapshot = replyTarget
        ? (() => {
            const base: any = {
              ...((replyTarget as any).messageId
                ? { messageId: (replyTarget as any).messageId }
                : {}),
              username: (replyTarget as any).username,
              text: (replyTarget as any).text || "",
              timestamp:
                (replyTarget as any).timestamp ??
                (replyTarget as any).createdAt ??
                null,
            };
            if ((replyTarget as any).kind) {
              base.kind = (replyTarget as any).kind;
            }
            if ((replyTarget as any).deleted) {
              base.deleted = true;
              base.text = "";
              if ((replyTarget as any).deletedAt) {
                base.deletedAt = (replyTarget as any).deletedAt;
              }
            }
            if (!base.deleted) {
              if ((replyTarget as any).media) {
                base.media = (replyTarget as any).media;
              }
              if ((replyTarget as any).audio) {
                base.audio = (replyTarget as any).audio;
              }
            }
            return base;
          })()
        : null;

      let succeeded = false;
      try {
        const store = useMessageStore.getState() as any;
        const current = (store.messages[dmId] || []) as any[];
        const optimisticMessage: any = {
          localId,
          username,
          text: "",
          timestamp: Date.now(),
          kind: "audio",
          audio: {
            url: objectUrl,
            durationMs,
            uploading: true,
          },
          ...(replySnapshot ? { replyTo: replySnapshot } : {}),
        };
        store.setMessages(dmId, [...current, optimisticMessage]);

        const { url } = await uploadChatMedia(file, username);

        const waveformSnapshot =
          queryClient.getQueryData<AudioWaveformSnapshot>(
            audioWaveformKey(objectUrl)
          );
        if (waveformSnapshot) {
          setAudioWaveformCache(queryClient, url, waveformSnapshot);
          queryClient.removeQueries({
            queryKey: audioWaveformKey(objectUrl),
            exact: true,
          });
        }

        const storeState = useMessageStore.getState() as any;
        const messagesForDm = (storeState.messages[dmId] || []) as any[];
        const targetIdx = messagesForDm.findIndex(
          (m: any) => (m as any).localId === localId
        );
        if (targetIdx !== -1) {
          const next = messagesForDm.slice();
          const currentMessage = next[targetIdx] || {};
          next[targetIdx] = {
            ...currentMessage,
            kind: "audio",
            audio: {
              ...(currentMessage.audio || {}),
              url,
              durationMs,
              uploading: false,
            },
          };
          storeState.setMessages(dmId, next);
        }

        sendDirectMessage(url, (replyTarget as any) || null, {
          kind: "audio",
          audio: { url, durationMs },
          localId,
          dmId,
        } as any);

        succeeded = true;
        if (replyTarget) clearReplyTarget();
      } catch (err) {
        const store = useMessageStore.getState() as any;
        const current = (store.messages[dmId] || []) as any[];
        const filtered = current.filter(
          (m: any) => (m as any).localId !== localId
        );
        store.setMessages(dmId, filtered);
      } finally {
        const pendingUrl = optimisticAudioUrls.current.get(localId);
        if (pendingUrl) {
          try {
            URL.revokeObjectURL(pendingUrl);
          } catch (err) {
            // ignore
          }
          optimisticAudioUrls.current.delete(localId);
        }
      }

      return succeeded;
    },
    [username, dmId, replyTarget, sendDirectMessage, clearReplyTarget]
  );

  const sendVoiceNoteAsync = useCallback(
    (
      blob: Blob | File,
      duration: number,
      mime: string | undefined,
      opts?: { onSuccess?: () => void; onFailure?: () => void }
    ) => {
      void (async () => {
        const ok = await sendDmVoiceNote(blob, duration, mime);
        if (ok) {
          opts?.onSuccess?.();
        } else {
          opts?.onFailure?.();
        }
      })();
    },
    [sendDmVoiceNote]
  );

  const restoreRecordingSnapshot = useCallback(
    (snapshot: RecordingSnapshot) => {
      const mime = snapshot.mimeType || "audio/webm";
      let url = snapshot.url || null;
      let owned = snapshot.urlOwned ?? false;

      if (!url || owned) {
        try {
          url = URL.createObjectURL(snapshot.blob);
          owned = true;
        } catch (err) {
          url = null;
          owned = false;
        }
      }

      previewBlobRef.current = {
        blob: snapshot.blob,
        mimeType: mime,
        durationMs: snapshot.durationMs,
      };

      if (url) {
        previewUrlRef.current = { url, owned };
        setPreview({
          url,
          durationMs: snapshot.durationMs,
          mimeType: mime,
        });
      } else {
        previewUrlRef.current = null;
        setPreview(null);
      }

      setRecorderLive(false);
      setRecording(true);
      setPaused(true);
      setRecordMs(snapshot.durationMs);
      setWaveformValues([]);
      elapsedBaseRef.current = snapshot.durationMs;
      sessionBaseRef.current = snapshot.durationMs;
      appendBaseRef.current = null;
      appendDurationRef.current = 0;
      appendMimeRef.current = mime;
      void persistPreview({
        blob: snapshot.blob,
        durationMs: snapshot.durationMs,
        mimeType: mime,
      }).catch(() => {});
    },
    [persistPreview]
  );

  const ensureRecordingPaused = useCallback(() => {
    const handle = voiceRef.current;
    const snapshot = latestRecorderStateRef.current;
    if (!handle) return;
    if (snapshot.live && snapshot.recording && !snapshot.paused) {
      try {
        handle.pause?.();
      } catch (err) {
        // ignore
      }
    }
  }, []);

  useEffect(() => {
    latestRecorderStateRef.current = {
      live: recorderLive,
      recording,
      paused,
    };
  }, [recorderLive, recording, paused]);

  useEffect(() => {
    if (!dmId || !isConnected) {
      ensureStopTyping();
      typingSignalRef.current.dmId = dmId ?? null;
      return;
    }

    const state = typingSignalRef.current;

    if (state.dmId && state.dmId !== dmId && state.active) {
      if (state.timeoutId != null) {
        clearTimeout(state.timeoutId);
        state.timeoutId = null;
      }
      sendTypingSignal(state.dmId, false);
      state.active = false;
      state.lastSentAt = 0;
    }

    state.dmId = dmId;

    if (messageInput.length > 0) {
      const now = Date.now();
      const shouldEmit =
        !state.active || state.dmId !== dmId || now - state.lastSentAt > 2500;

      if (shouldEmit) {
        sendTypingSignal(dmId, true);
        state.lastSentAt = now;
      }

      state.active = true;

      if (state.timeoutId != null) {
        clearTimeout(state.timeoutId);
      }
      state.timeoutId = window.setTimeout(() => {
        const current = typingSignalRef.current;
        current.timeoutId = null;
        if (!current.active || current.dmId !== dmId) return;
        sendTypingSignal(dmId, false);
        current.active = false;
        current.lastSentAt = 0;
      }, 4000);
    } else {
      ensureStopTyping(dmId);
    }
  }, [dmId, isConnected, messageInput, sendTypingSignal, ensureStopTyping]);

  useEffect(() => {
    return () => {
      ensureStopTyping(null);
      typingSignalRef.current.dmId = null;
    };
  }, [ensureStopTyping]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        ensureRecordingPaused();
      }
    };
    const handlePageHide = () => {
      ensureRecordingPaused();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", handlePageHide);
      window.addEventListener("beforeunload", handlePageHide);
    }
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      if (typeof window !== "undefined") {
        window.removeEventListener("pagehide", handlePageHide);
        window.removeEventListener("beforeunload", handlePageHide);
      }
    };
  }, [ensureRecordingPaused]);

  useEffect(() => {
    return () => {
      ensureRecordingPaused();
    };
  }, [ensureRecordingPaused]);

  const fmt = useCallback((ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (totalSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  }, []);

  useEffect(() => {
    if (recorderLive) return;
    if (!cachedRecording) {
      previewBlobRef.current = null;
      if (previewUrlRef.current?.owned) {
        try {
          URL.revokeObjectURL(previewUrlRef.current.url);
        } catch (err) {
          // ignore
        }
      }
      previewUrlRef.current = null;
      setPreview(null);
      setRecording(false);
      setPaused(false);
      setRecordMs(0);
      elapsedBaseRef.current = 0;
      sessionBaseRef.current = 0;
      appendBaseRef.current = null;
      appendDurationRef.current = 0;
      appendMimeRef.current = null;
      return;
    }

    previewBlobRef.current = {
      blob: cachedRecording.blob,
      mimeType: cachedRecording.mimeType,
      durationMs: cachedRecording.durationMs,
    };
    if (previewUrlRef.current?.owned) {
      try {
        URL.revokeObjectURL(previewUrlRef.current.url);
      } catch (err) {
        // ignore
      }
    }
    previewUrlRef.current = {
      url: cachedRecording.url,
      owned: false,
    };
    setPreview({
      url: cachedRecording.url,
      durationMs: cachedRecording.durationMs,
      mimeType: cachedRecording.mimeType,
    });
    setRecordMs(cachedRecording.durationMs);
    setRecording(true);
    setPaused(true);
    elapsedBaseRef.current = cachedRecording.durationMs;
    sessionBaseRef.current = cachedRecording.durationMs;
  }, [cachedRecording, recorderLive]);

  const resetRecordingUi = useCallback(
    (opts?: { keepRecording?: boolean; baseMs?: number }) => {
      if (opts?.keepRecording) {
        const base =
          typeof opts.baseMs === "number"
            ? opts.baseMs
            : elapsedBaseRef.current;
        setRecordMs(base);
        setWaveformValues([]);
        setPreview(null);
        return;
      }

      setRecording(false);
      setPaused(false);
      setRecordMs(0);
      setWaveformValues([]);
      setPreview(null);
      elapsedBaseRef.current = 0;
      sessionBaseRef.current = 0;
      appendBaseRef.current = null;
      appendDurationRef.current = 0;
      appendMimeRef.current = null;
      previewBlobRef.current = null;
      if (previewUrlRef.current?.owned) {
        try {
          URL.revokeObjectURL(previewUrlRef.current.url);
        } catch (err) {
          // ignore
        }
      }
      previewUrlRef.current = null;
    },
    []
  );

  const handleSendCachedRecording = useCallback(() => {
    const cached = previewBlobRef.current;
    if (!cached) return;

    const urlSnapshot = previewUrlRef.current;
    const snapshot: RecordingSnapshot = {
      blob: cached.blob,
      durationMs: cached.durationMs,
      mimeType: cached.mimeType || "audio/webm",
      url: urlSnapshot?.url,
      urlOwned: urlSnapshot?.owned ?? false,
    };

    resetRecordingUi();
    setRecorderLive(false);

    sendVoiceNoteAsync(snapshot.blob, snapshot.durationMs, snapshot.mimeType, {
      onSuccess: () => {
        void clearPreview().catch(() => {});
      },
      onFailure: () => {
        restoreRecordingSnapshot(snapshot);
        showToast("Failed to send voice note. Draft restored.", 2600, "error");
      },
    });
  }, [
    clearPreview,
    resetRecordingUi,
    restoreRecordingSnapshot,
    sendVoiceNoteAsync,
    showToast,
  ]);

  const handleDiscardRecording = useCallback(() => {
    voiceRef.current?.cancel();
    previewBlobRef.current = null;
    setRecorderLive(false);
    resetRecordingUi();
    void clearPreview().catch(() => {});
  }, [clearPreview, resetRecordingUi]);

  const handleResumeRecording = useCallback(() => {
    if (!recording || !paused) return;
    if (recorderLive) {
      voiceRef.current?.resume?.();
      return;
    }
    const existing = previewBlobRef.current;
    if (existing) {
      appendBaseRef.current = existing.blob;
      appendDurationRef.current = existing.durationMs;
      appendMimeRef.current = existing.mimeType;
      elapsedBaseRef.current = existing.durationMs;
      sessionBaseRef.current = existing.durationMs;
      setWaveformValues([]);
    } else {
      appendBaseRef.current = null;
      appendDurationRef.current = 0;
      appendMimeRef.current = null;
      elapsedBaseRef.current = 0;
      sessionBaseRef.current = 0;
      setWaveformValues([]);
    }
    setRecording(true);
    setPaused(false);
    voiceRef.current?.start?.();
  }, [paused, recording, recorderLive]);

  const handlePauseRecording = useCallback(() => {
    if (!recording || paused || !recorderLive) return;
    voiceRef.current?.pause?.();
  }, [paused, recording, recorderLive]);

  useEffect(() => {
    return () => {
      optimisticAudioUrls.current.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch (err) {
          // ignore
        }
      });
      optimisticAudioUrls.current.clear();
    };
  }, []);

  const handleComposerSend = useCallback(() => {
    if (recording) {
      if (recorderLive) {
        voiceRef.current?.stop();
      } else if (previewBlobRef.current) {
        handleSendCachedRecording();
      }
      return;
    }

    if (previewBlobRef.current) {
      handleSendCachedRecording();
      return;
    }

    onSendTextMessage();
  }, [recording, recorderLive, handleSendCachedRecording, onSendTextMessage]);

  const handleEmojiClick = useCallback(() => {
    const el = inputRef.current;
    if (el) {
      setCursorPos(el.selectionStart ?? messageInput.length);
    }
    setEmojiOpen(true);
  }, [inputRef, messageInput, setCursorPos, setEmojiOpen]);

  const handleGifClick = useCallback(() => {
    const el = inputRef.current;
    if (el) {
      setCursorPos(el.selectionStart ?? messageInput.length);
    }
    setGifOpen(true);
  }, [inputRef, messageInput, setCursorPos, setGifOpen]);

  const placeholder = useMemo(() => {
    if (editingMessage) return "Edit your message...";
    if (replyTarget) {
      const targetName =
        replyTarget.username === username ? "yourself" : replyTarget.username;
      return `Reply to ${targetName ?? "sender"}…`;
    }
    return "Type a message...";
  }, [editingMessage, replyTarget, username]);

  const composerDisabled = !isConnected || !dmId;
  const sendDisabled =
    !isConnected ||
    !dmId ||
    (!messageInput.trim() && !editingMessage && !recording);

  return (
    <div className="px-4 py-3">
      {editingMessage && (
        <EditingPreview
          message={editingMessage as any}
          onClose={onCancelEditing}
          AnimatedMedia={({ url, mediaSources }) => (
            <AnimatedMedia url={url} mediaSources={mediaSources as any} />
          )}
          isGifUrl={isGifUrl}
          isEmojiOnly={isEmojiOnly}
          isVideoUrl={isVideoUrl}
        />
      )}

      {!editingMessage && replyTarget && (
        <ReplyingPreview
          reply={replyTarget as any}
          currentUsername={username}
          onClose={onCancelReplying}
          AnimatedMedia={({ url, mediaSources }) => (
            <AnimatedMedia url={url} mediaSources={mediaSources as any} />
          )}
          isGifUrl={isGifUrl}
          isEmojiOnly={isEmojiOnly}
          isVideoUrl={isVideoUrl}
        />
      )}

      {composerPreviewActiveUrl && (
        <div className="mb-3">
          {composerPreviewQuery.isLoading || composerPreviewQuery.isFetching ? (
            <LinkPreviewSkeleton className="mt-0" />
          ) : composerPreviewQuery.data ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
              <LinkPreviewCard
                url={composerPreviewActiveUrl}
                data={composerPreviewQuery.data}
                className="flex-1"
              />
              <button
                type="button"
                onClick={() => onDismissLinkPreview(composerPreviewActiveUrl)}
                className="inline-flex items-center gap-1 self-end rounded-full px-3 py-1 text-xs font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-300"
                aria-label="Remove link preview"
              >
                <X size={14} weight="bold" />
                Remove preview
              </button>
            </div>
          ) : null}
        </div>
      )}

      <TextComposer
        value={messageInput}
        setValue={setMessageInput}
        setCursorPos={setCursorPos}
        inputRef={inputRef}
        disabled={composerDisabled}
        placeholder={placeholder}
        onSend={handleComposerSend}
        onEscape={() => {
          if (editingMessage) onCancelEditing();
          else if (replyTarget) onCancelReplying();
          else if (sheetOpen) onCloseSheet();
        }}
        onEmojiClick={handleEmojiClick}
        onGifClick={handleGifClick}
        renderMediaUpload={
          <MediaUpload
            title="Upload image or video"
            label="Photo or video"
            className=""
            disabled={composerDisabled}
            mode="dm"
            dmId={dmId || undefined}
            allowVideo
          />
        }
        renderVoiceRecorder={
          <VoiceRecorder
            ref={voiceRef as any}
            disabled={composerDisabled}
            onComplete={async (file, { durationMs }) => {
              let payload: Blob | File = file;
              let totalDuration = durationMs;
              let mime = file.type;

              const baseBlob =
                appendBaseRef.current || previewBlobRef.current?.blob || null;
              const baseDuration = appendDurationRef.current
                ? appendDurationRef.current
                : previewBlobRef.current?.durationMs || 0;
              const baseMime =
                appendMimeRef.current || previewBlobRef.current?.mimeType;

              if (baseBlob && baseDuration) {
                mime = baseMime || mime || "audio/webm";
                try {
                  const merged = await mergeAudioBlobs(baseBlob, file);
                  if (merged) {
                    payload = merged.blob;
                    mime = merged.mimeType;
                  } else {
                    payload = new Blob([baseBlob, file], { type: mime });
                  }
                } catch (err) {
                  payload = new Blob([baseBlob, file], { type: mime });
                }
                totalDuration = baseDuration + durationMs;
              }

              appendBaseRef.current = null;
              appendDurationRef.current = 0;
              appendMimeRef.current = null;
              previewBlobRef.current = null;
              elapsedBaseRef.current = 0;
              sessionBaseRef.current = 0;

              const snapshot: RecordingSnapshot = {
                blob: payload,
                durationMs: totalDuration,
                mimeType: mime || "audio/webm",
              };

              resetRecordingUi();
              setRecorderLive(false);

              sendVoiceNoteAsync(
                snapshot.blob,
                snapshot.durationMs,
                snapshot.mimeType,
                {
                  onSuccess: () => {
                    void clearPreview().catch(() => {});
                  },
                  onFailure: () => {
                    restoreRecordingSnapshot(snapshot);
                    showToast(
                      "Failed to send voice note. Draft restored.",
                      2600,
                      "error"
                    );
                  },
                }
              );
            }}
            onStateChange={(state) => {
              if (state === "recording") {
                setRecorderLive(true);
                setRecording(true);
                setPaused(false);
                setWaveformValues([]);
                resetRecordingUi({
                  keepRecording: true,
                  baseMs: elapsedBaseRef.current,
                });
                if (!previewBlobRef.current) {
                  void clearPreview().catch(() => {});
                }
              } else if (state === "paused") {
                setRecorderLive(true);
                setRecording(true);
                setPaused(true);
              } else if (state === "stopped") {
                setRecorderLive(false);
                setPaused(false);
              } else if (state === "idle") {
                setRecorderLive(false);
                resetRecordingUi();
              }
            }}
            onTick={(ms) => setRecordMs(sessionBaseRef.current + ms)}
            onWaveform={(vals) => setWaveformValues(vals)}
            onPreview={(info) => {
              void (async () => {
                if (info && info.blob) {
                  const baseBlob = appendBaseRef.current;
                  const baseDuration = appendDurationRef.current;
                  const baseMime = appendMimeRef.current;

                  if (previewUrlRef.current?.owned) {
                    try {
                      URL.revokeObjectURL(previewUrlRef.current.url);
                    } catch (err) {
                      // ignore
                    }
                    previewUrlRef.current = null;
                  }

                  let combinedBlob: Blob = info.blob;
                  let combinedDuration = info.durationMs;
                  let mime = baseMime || info.mimeType || "audio/webm";
                  let url = info.url;
                  let ownsUrl = false;

                  if (baseBlob && baseDuration) {
                    try {
                      const merged = await mergeAudioBlobs(baseBlob, info.blob);
                      if (merged) {
                        combinedBlob = merged.blob;
                        mime = merged.mimeType;
                      } else {
                        combinedBlob = new Blob([baseBlob, info.blob], {
                          type: mime,
                        });
                      }
                    } catch (err) {
                      combinedBlob = new Blob([baseBlob, info.blob], {
                        type: mime,
                      });
                    }
                    combinedDuration = baseDuration + info.durationMs;
                    try {
                      URL.revokeObjectURL(info.url);
                    } catch (err) {
                      // ignore
                    }
                    url = URL.createObjectURL(combinedBlob);
                    ownsUrl = true;
                  } else {
                    combinedDuration = elapsedBaseRef.current + info.durationMs;
                  }

                  previewUrlRef.current = { url, owned: ownsUrl };
                  setPreview({
                    url,
                    durationMs: combinedDuration,
                    mimeType: mime,
                  });
                  previewBlobRef.current = {
                    blob: combinedBlob,
                    mimeType: mime,
                    durationMs: combinedDuration,
                  };
                  elapsedBaseRef.current = combinedDuration;
                  appendBaseRef.current = null;
                  appendDurationRef.current = 0;
                  appendMimeRef.current = null;
                  setRecordMs(combinedDuration);
                  await persistPreview({
                    blob: combinedBlob,
                    durationMs: combinedDuration,
                    mimeType: mime,
                  }).catch(() => {});
                } else {
                  setPreview(null);
                }
              })();
            }}
          />
        }
        recordingActive={recording}
        renderRecordingInline={
          recording ? (
            <div className="mx-auto flex w-full max-w-[20rem] items-center justify-between gap-3 text-xs text-red-600">
              {!paused && (
                <span className="select-none tabular-nums">
                  {fmt(recordMs)}
                </span>
              )}

              <div className="flex-1 overflow-hidden">
                {paused ? (
                  preview ? (
                    <AudioWave
                      key={preview.url}
                      url={preview.url}
                      durationMs={preview.durationMs}
                      backgroundColor="#f3f4f6"
                      trackColor="#d1d5db"
                    />
                  ) : (
                    <span className="block truncate text-[11px] text-gray-400 select-none">
                      Preparing preview…
                    </span>
                  )
                ) : (
                  <LiveWaveform
                    values={waveformValues}
                    paused={paused}
                    capacity={RECORDING_WAVEFORM_CAP}
                    className="w-full"
                  />
                )}
              </div>

              <div className="flex items-center gap-3 text-gray-500">
                {!paused && (
                  <button
                    type="button"
                    aria-label="Pause recording"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handlePauseRecording}
                    disabled={!recording || paused}
                    className={`text-red-500 transition ${
                      !recording || paused
                        ? "opacity-40 cursor-not-allowed"
                        : "hover:text-red-600"
                    }`}
                  >
                    <Pause size={24} />
                  </button>
                )}
                {paused && (
                  <button
                    type="button"
                    aria-label="Resume recording"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleResumeRecording}
                    disabled={!(recording && paused)}
                    className={`text-red-500 transition ${
                      !(recording && paused)
                        ? "opacity-40 cursor-not-allowed"
                        : "hover:text-red-600"
                    }`}
                  >
                    <Microphone size={24} />
                  </button>
                )}
                <button
                  type="button"
                  aria-label={
                    recorderLive ? "Cancel recording" : "Discard preview"
                  }
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={handleDiscardRecording}
                  className="hover:text-gray-600"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 256 256"
                    fill="currentColor"
                    aria-hidden
                  >
                    <path d="M216 56h-36V40a24 24 0 0 0-24-24h-56a24 24 0 0 0-24 24v16H40a8 8 0 0 0 0 16h8v136a24 24 0 0 0 24 24h112a24 24 0 0 0 24-24V72h8a8 8 0 0 0 0-16ZM96 40a8 8 0 0 1 8-8h56a8 8 0 0 1 8 8v16H96Zm96 168a8 8 0 0 1-8 8H72a8 8 0 0 1-8-8V72h128Zm-80-96v64a8 8 0 0 1-16 0v-64a8 8 0 0 1 16 0Zm48 0v64a8 8 0 0 1-16 0v-64a8 8 0 0 1 16 0Z" />
                  </svg>
                </button>
              </div>
            </div>
          ) : null
        }
        sendDisabled={sendDisabled}
        editing={!!editingMessage}
      />
    </div>
  );
};

export default ComposerPanel;
