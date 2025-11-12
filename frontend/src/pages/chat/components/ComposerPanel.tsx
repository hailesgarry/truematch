import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import TextComposer from "../../../components/chat/TextComposer";
import {
  EditingPreview,
  ReplyingPreview,
} from "../../../components/chat/ComposerPreview";
import LinkPreviewCard, {
  LinkPreviewSkeleton,
} from "../../../components/chat/LinkPreviewCard";
import AudioWave from "../../../components/common/AudioWave";
import { useLinkPreview } from "../../../hooks/useLinkPreview";
import { useComposerDraftCache } from "../../../hooks/useComposerDraftCache";
import { useComposerRecordingCache } from "../../../hooks/useComposerRecordingCache";
import { useGroupStore } from "../../../stores/groupStore";
import { useComposerStore } from "../../../stores/composerStore";
import { useUiStore } from "../../../stores/uiStore";
import { useMessageStore } from "../../../stores/messageStore";
import { useSocketStore } from "../../../stores/socketStore";
import { mergeAudioBlobs } from "../../../utils/audioMerge";
import { extractLinks } from "../../../utils/links";
import { uploadChatMedia } from "../../../services/api";
import {
  DeferredMediaUpload,
  DeferredVoiceRecorder,
  LazyLiveWaveform,
} from "../asyncComponents";
import { RECORDING_WAVEFORM_CAP } from "../chatConstants";
import { AnimatedMedia } from "../media";
import { isGifUrl, isImageUrl, isVideoUrl } from "../text";
import type { Message } from "../../../types";
import type { RecordingSnapshot } from "../types";
import type { VoiceRecorderHandle } from "../../../components/common/VoiceRecorder";
import { Pause, Microphone, X } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  audioWaveformKey,
  setAudioWaveformCache,
  type AudioWaveformSnapshot,
} from "../../../lib/audioWaveCache";

export type ComposerPanelHandle = {
  focusComposer: () => void;
  ensureRecordingPaused: () => void;
  insertMention: (username: string) => void;
};

export type ComposerPanelProps = {
  isConnected: boolean;
  currentGroup: {
    id: string;
    name?: string | null;
  } | null;
  username: string | null | undefined;
  editingMessage: Message | null;
  replyTarget: Message | null;
  sheetOpen: boolean;
  onRequestCloseSheet: () => void;
  onOpenEmojiPicker: () => void;
  onOpenGifPicker: () => void;
  onCancelEditing: () => void;
  onCancelReplying: () => void;
};

const ComposerPanel = React.forwardRef<ComposerPanelHandle, ComposerPanelProps>(
  (
    {
      isConnected,
      currentGroup,
      username,
      editingMessage,
      replyTarget,
      sheetOpen,
      onRequestCloseSheet,
      onOpenEmojiPicker,
      onOpenGifPicker,
      onCancelEditing,
      onCancelReplying,
    },
    ref
  ) => {
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const voiceRef = useRef<VoiceRecorderHandle | null>(null);
    const optimisticAudioUrls = useRef<Map<string, string>>(new Map());
    const appendBaseRef = useRef<Blob | null>(null);
    const appendDurationRef = useRef(0);
    const appendMimeRef = useRef<string | null>(null);
    const previewBlobRef = useRef<{
      blob: Blob;
      mimeType: string;
      durationMs: number;
    } | null>(null);
    const previewUrlRef = useRef<{ url: string; owned: boolean } | null>(null);
    const elapsedBaseRef = useRef(0);
    const sessionBaseRef = useRef(0);
    const latestRecorderStateRef = useRef({
      live: false,
      recording: false,
      paused: false,
    });

    const {
      activeScope,
      draft: messageInput,
      setDraft: setMessageInput,
      resetDraft,
      setCursorPos,
      cursorPos,
      shouldFocus,
      consumeFocus,
    } = useComposerStore();
    const {
      preview: cachedRecording,
      persistPreview: persistRecordingPreview,
      clearPreview: clearRecordingPreview,
    } = useComposerRecordingCache(activeScope);
    const queryClient = useQueryClient();

    useComposerDraftCache(
      activeScope,
      messageInput,
      cursorPos,
      setMessageInput
    );

    const showToast = useUiStore((s) => s.showToast);
    const onlineUsers = useGroupStore((s) => s.onlineUsers);

    const [mentionOpen, setMentionOpen] = useState(false);
    const [mentionQuery, setMentionQuery] = useState("");
    const [mentionIndex, setMentionIndex] = useState(0);

    const [composerPreviewDismissedFor, setComposerPreviewDismissedFor] =
      useState<string | null>(null);

    const [recording, setRecording] = useState(false);
    const [paused, setPaused] = useState(false);
    const [recordMs, setRecordMs] = useState(0);
    const [waveformValues, setWaveformValues] = useState<number[]>([]);
    const [preview, setPreview] = useState<{
      url: string;
      durationMs: number;
      mimeType?: string;
    } | null>(null);
    const [recorderLive, setRecorderLive] = useState(false);

    const restoreRecordingSnapshot = useCallback(
      (snapshot: RecordingSnapshot) => {
        const mime = snapshot.mimeType || "audio/webm";
        let url = snapshot.url || null;
        let owned = snapshot.urlOwned ?? false;

        if (!url || owned) {
          try {
            url = URL.createObjectURL(snapshot.blob);
            owned = true;
          } catch {
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

        void persistRecordingPreview({
          blob: snapshot.blob,
          durationMs: snapshot.durationMs,
          mimeType: mime,
        }).catch(() => {});
      },
      [
        persistRecordingPreview,
        setPreview,
        setRecorderLive,
        setRecording,
        setPaused,
        setRecordMs,
        setWaveformValues,
      ]
    );

    const ensureRecordingPaused = useCallback(() => {
      const handle = voiceRef.current;
      const snapshot = latestRecorderStateRef.current;
      if (!handle) return;
      if (snapshot.live && snapshot.recording && !snapshot.paused) {
        try {
          handle.pause?.();
        } catch {
          /* ignore */
        }
      }
    }, []);

    const messageLinks = useMemo(
      () => extractLinks(messageInput || ""),
      [messageInput]
    );

    const composerPreviewCandidate = useMemo(() => {
      for (const link of messageLinks) {
        if (
          !isGifUrl(link.url) &&
          !isVideoUrl(link.url) &&
          !isImageUrl(link.url)
        ) {
          return link.url;
        }
      }
      return null;
    }, [messageLinks]);

    useEffect(() => {
      if (!composerPreviewCandidate) {
        if (composerPreviewDismissedFor !== null) {
          setComposerPreviewDismissedFor(null);
        }
        return;
      }
      if (
        composerPreviewDismissedFor &&
        composerPreviewCandidate !== composerPreviewDismissedFor
      ) {
        setComposerPreviewDismissedFor(null);
      }
    }, [composerPreviewCandidate, composerPreviewDismissedFor]);

    const composerPreviewActiveUrl =
      composerPreviewCandidate &&
      composerPreviewCandidate !== composerPreviewDismissedFor
        ? composerPreviewCandidate
        : null;

    const composerPreviewQuery = useLinkPreview(composerPreviewActiveUrl, {
      enabled: Boolean(composerPreviewActiveUrl),
    });

    const mentionCandidates = useMemo(() => {
      if (!mentionOpen) return [] as string[];
      const q = mentionQuery.toLowerCase();
      const base = onlineUsers
        .map((u: any) => u.username)
        .filter((u) => u && u !== username);
      const uniq = Array.from(new Set(base));
      return uniq.filter((u) => u.toLowerCase().startsWith(q)).slice(0, 8);
    }, [mentionOpen, mentionQuery, onlineUsers, username]);

    useEffect(() => {
      if (mentionIndex >= mentionCandidates.length) setMentionIndex(0);
    }, [mentionCandidates, mentionIndex]);

    useEffect(() => {
      if (!shouldFocus) return;
      const el = inputRef.current;
      if (el) {
        el.focus();
        try {
          const pos =
            typeof cursorPos === "number" ? cursorPos : el.value.length;
          el.setSelectionRange(pos, pos);
        } catch {
          /* ignore selection errors */
        }
      }
      consumeFocus();
    }, [shouldFocus, consumeFocus, cursorPos]);

    const detectMention = useCallback((value: string, caret: number) => {
      let i = caret - 1;
      while (i >= 0) {
        const ch = value[i];
        if (ch === " " || ch === "\n" || ch === "\t") break;
        i--;
      }
      const start = i + 1;
      const token = value.slice(start, caret);
      if (token.startsWith("@")) return { token, start, end: caret };
      return null;
    }, []);

    const insertMention = useCallback(
      (name: string) => {
        if (!inputRef.current) return;
        const el = inputRef.current;
        const value = el.value;
        const caret = el.selectionStart || 0;
        const info = detectMention(value, caret);
        if (!info) return;
        const before = value.slice(0, info.start);
        const after = value.slice(info.end);
        const nextVal = `${before}@${name} ${after}`;
        setMessageInput(nextVal);
        const newCaret = before.length + name.length + 2;
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(newCaret, newCaret);
        });
        setMentionOpen(false);
        setMentionQuery("");
        setMentionIndex(0);
      },
      [detectMention, setMessageInput]
    );

    const insertMentionToken = useCallback(
      (rawTarget: string) => {
        const target = rawTarget.trim();
        if (!target) return;

        const current = messageInput || "";
        let caret = typeof cursorPos === "number" ? cursorPos : current.length;
        caret = Math.max(0, Math.min(current.length, caret));

        const before = current.slice(0, caret);
        const after = current.slice(caret);
        const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
        const insertion = `${needsLeadingSpace ? " " : ""}@${target} `;
        const nextVal = before + insertion + after;
        const nextCaret = before.length + insertion.length;

        setMessageInput(nextVal, nextCaret);
        setMentionOpen(false);
        setMentionQuery("");
        setMentionIndex(0);

        setTimeout(() => {
          const el = inputRef.current;
          if (el) {
            el.focus();
            try {
              el.setSelectionRange(nextCaret, nextCaret);
            } catch {
              /* ignore selection errors */
            }
          }
        }, 50);
      },
      [cursorPos, messageInput, setMessageInput]
    );

    const handleSendMessage = useCallback(() => {
      if (mentionOpen && mentionCandidates.length > 0) {
        insertMention(mentionCandidates[mentionIndex]);
        return;
      }
      if (!messageInput.trim()) return;

      if (editingMessage) {
        useSocketStore
          .getState()
          .editMessage(editingMessage as any, messageInput);
        onCancelEditing();
        return;
      }

      useSocketStore
        .getState()
        .sendMessage(messageInput, (replyTarget as any) || null, {
          kind: "text",
        });
      resetDraft();
      if (replyTarget) onCancelReplying();
    }, [
      mentionOpen,
      mentionCandidates,
      mentionIndex,
      insertMention,
      messageInput,
      editingMessage,
      onCancelEditing,
      replyTarget,
      resetDraft,
      onCancelReplying,
    ]);

    const sendVoiceNote = useCallback(
      async (source: Blob | File, durationMs: number, mimeType?: string) => {
        if (!username || !currentGroup) return false;
        if (!Number.isFinite(durationMs) || durationMs <= 0) return false;

        const groupId = currentGroup.id;
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
          const current = (store.messages[groupId] || []) as any[];
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
          store.setMessages(groupId, [...current, optimisticMessage]);

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

          const messageStore = useMessageStore.getState() as any;
          const existingMessages = (messageStore.messages[groupId] ||
            []) as any[];
          const targetIdx = existingMessages.findIndex(
            (m: any) => (m as any).localId === localId
          );
          if (targetIdx !== -1) {
            const next = existingMessages.slice();
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
            messageStore.setMessages(groupId, next);
          }

          useSocketStore
            .getState()
            .sendMessage(url, (replyTarget as any) || null, {
              kind: "audio",
              audio: { url, durationMs },
              localId,
            } as any);

          succeeded = true;
          if (replyTarget) onCancelReplying();
        } catch (e) {
          const ms = useMessageStore.getState() as any;
          const current = (ms.messages[groupId] || []) as any[];
          const filtered = current.filter(
            (m: any) => (m as any).localId !== localId
          );
          ms.setMessages(groupId, filtered);
        } finally {
          const pendingUrl = optimisticAudioUrls.current.get(localId);
          if (pendingUrl) {
            try {
              URL.revokeObjectURL(pendingUrl);
            } catch {
              /* noop */
            }
            optimisticAudioUrls.current.delete(localId);
          }
        }

        return succeeded;
      },
      [username, currentGroup, replyTarget, onCancelReplying]
    );

    const sendVoiceNoteAsync = useCallback(
      (
        blob: Blob | File,
        duration: number,
        mime: string | undefined,
        opts?: { onSuccess?: () => void; onFailure?: () => void }
      ) => {
        void (async () => {
          const ok = await sendVoiceNote(blob, duration, mime);
          if (ok) {
            opts?.onSuccess?.();
          } else {
            opts?.onFailure?.();
          }
        })();
      },
      [sendVoiceNote]
    );

    useImperativeHandle(
      ref,
      () => ({
        focusComposer: () => {
          const el = inputRef.current;
          if (el) {
            el.focus();
            try {
              const pos = el.value.length;
              el.setSelectionRange(pos, pos);
            } catch {
              /* ignore */
            }
          }
        },
        ensureRecordingPaused,
        insertMention: insertMentionToken,
      }),
      [ensureRecordingPaused, insertMentionToken]
    );

    useEffect(() => {
      latestRecorderStateRef.current = {
        live: recorderLive,
        recording,
        paused,
      };
    }, [recorderLive, recording, paused]);

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
      const s = Math.floor(ms / 1000);
      const m = Math.floor(s / 60)
        .toString()
        .padStart(2, "0");
      const ss = (s % 60).toString().padStart(2, "0");
      return `${m}:${ss}`;
    }, []);

    useEffect(() => {
      if (recorderLive) return;
      if (!cachedRecording) {
        previewBlobRef.current = null;
        if (previewUrlRef.current?.owned) {
          try {
            URL.revokeObjectURL(previewUrlRef.current.url);
          } catch {
            /* ignore */
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
        } catch {
          /* ignore */
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
        appendBaseRef.current = null;
        appendDurationRef.current = 0;
        appendMimeRef.current = null;
        sessionBaseRef.current = 0;
        previewBlobRef.current = null;
        if (previewUrlRef.current?.owned) {
          try {
            URL.revokeObjectURL(previewUrlRef.current.url);
          } catch {
            /* ignore */
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

      sendVoiceNoteAsync(
        snapshot.blob,
        snapshot.durationMs,
        snapshot.mimeType,
        {
          onSuccess: () => {
            void clearRecordingPreview().catch(() => {});
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
    }, [
      clearRecordingPreview,
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
      void clearRecordingPreview().catch(() => {});
    }, [clearRecordingPreview, resetRecordingUi]);

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
          } catch {
            /* ignore */
          }
        });
        optimisticAudioUrls.current.clear();
      };
    }, []);

    const onComposerSend = useCallback(() => {
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

      handleSendMessage();
    }, [handleSendCachedRecording, handleSendMessage, recording, recorderLive]);

    const cancelEditing = useCallback(() => {
      onCancelEditing();
    }, [onCancelEditing]);

    const cancelReplying = useCallback(() => {
      onCancelReplying();
    }, [onCancelReplying]);

    const onEscape = useCallback(() => {
      if (editingMessage) cancelEditing();
      else if (replyTarget) cancelReplying();
      else if (sheetOpen) onRequestCloseSheet();
    }, [
      cancelEditing,
      cancelReplying,
      editingMessage,
      replyTarget,
      sheetOpen,
      onRequestCloseSheet,
    ]);

    const onEmojiClick = useCallback(() => {
      if (inputRef.current) {
        setCursorPos(inputRef.current.selectionStart ?? messageInput.length);
      }
      onOpenEmojiPicker();
    }, [messageInput.length, onOpenEmojiPicker, setCursorPos]);

    const onGifClick = useCallback(() => {
      if (inputRef.current) {
        setCursorPos(inputRef.current.selectionStart ?? messageInput.length);
      }
      onOpenGifPicker();
    }, [messageInput.length, onOpenGifPicker, setCursorPos]);

    return (
      <div className="px-4 py-3">
        {editingMessage && (
          <EditingPreview
            message={editingMessage}
            onClose={cancelEditing}
            AnimatedMedia={({ url, mediaSources }) => (
              <AnimatedMedia url={url} mediaSources={mediaSources as any} />
            )}
            isGifUrl={isGifUrl}
            isEmojiOnly={() => false}
            isVideoUrl={isVideoUrl}
          />
        )}

        {!editingMessage && replyTarget && (
          <ReplyingPreview
            reply={replyTarget as any}
            currentUsername={username || undefined}
            onClose={cancelReplying}
            AnimatedMedia={({ url, mediaSources }) => (
              <AnimatedMedia url={url} mediaSources={mediaSources as any} />
            )}
            isGifUrl={isGifUrl}
            isEmojiOnly={() => false}
            isVideoUrl={isVideoUrl}
          />
        )}

        {composerPreviewActiveUrl && (
          <div className="mb-3">
            {composerPreviewQuery.isLoading ||
            composerPreviewQuery.isFetching ? (
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
                  onClick={() =>
                    setComposerPreviewDismissedFor(composerPreviewActiveUrl)
                  }
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
          disabled={!isConnected || !currentGroup}
          placeholder={
            editingMessage
              ? "Edit your message..."
              : replyTarget
              ? `Reply to ${
                  replyTarget.username === username
                    ? "yourself"
                    : replyTarget.username
                }…`
              : "Type a message..."
          }
          onSend={onComposerSend}
          onEscape={onEscape}
          onEmojiClick={onEmojiClick}
          onGifClick={onGifClick}
          renderMediaUpload={
            <DeferredMediaUpload
              title="Upload image or video"
              label="Photo or video"
              className=""
              disabled={!isConnected || !currentGroup}
              allowVideo
            />
          }
          renderVoiceRecorder={
            <DeferredVoiceRecorder
              ref={voiceRef as any}
              disabled={!isConnected || !currentGroup}
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
                  } catch {
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
                      void clearRecordingPreview().catch(() => {});
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
              onStateChange={(st) => {
                if (st === "recording") {
                  setRecorderLive(true);
                  setRecording(true);
                  setPaused(false);
                  setWaveformValues([]);
                  resetRecordingUi({
                    keepRecording: true,
                    baseMs: elapsedBaseRef.current,
                  });
                  if (!previewBlobRef.current) {
                    void clearRecordingPreview().catch(() => {});
                  }
                } else if (st === "paused") {
                  setRecorderLive(true);
                  setRecording(true);
                  setPaused(true);
                } else if (st === "stopped") {
                  setRecorderLive(false);
                  setPaused(false);
                } else if (st === "idle") {
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
                      } catch {
                        /* ignore */
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
                        const merged = await mergeAudioBlobs(
                          baseBlob,
                          info.blob
                        );
                        if (merged) {
                          combinedBlob = merged.blob;
                          mime = merged.mimeType;
                        } else {
                          combinedBlob = new Blob([baseBlob, info.blob], {
                            type: mime,
                          });
                        }
                      } catch {
                        combinedBlob = new Blob([baseBlob, info.blob], {
                          type: mime,
                        });
                      }
                      combinedDuration = baseDuration + info.durationMs;
                      try {
                        URL.revokeObjectURL(info.url);
                      } catch {
                        /* ignore */
                      }
                      url = URL.createObjectURL(combinedBlob);
                      ownsUrl = true;
                    } else {
                      combinedDuration =
                        elapsedBaseRef.current + info.durationMs;
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
                    await persistRecordingPreview({
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
                        progressColor="#6b7280"
                        buttonIconColor="#6b7280"
                      />
                    ) : (
                      <span className="block truncate text-[11px] text-gray-400 select-none">
                        Preparing preview…
                      </span>
                    )
                  ) : (
                    <LazyLiveWaveform
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
          sendDisabled={
            !isConnected ||
            !currentGroup ||
            (!messageInput.trim() && !recording)
          }
          editing={!!editingMessage}
          mention={{
            open: mentionOpen,
            candidates: mentionCandidates,
            index: mentionIndex,
            setOpen: setMentionOpen,
            setQuery: setMentionQuery,
            setIndex: setMentionIndex,
            detect: detectMention,
            insert: insertMention,
          }}
        />
      </div>
    );
  }
);
ComposerPanel.displayName = "ComposerPanel";

export default ComposerPanel;
