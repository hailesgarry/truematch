import React from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import type { Message } from "../../../types";
import ChatBubble from "../../../components/chat/ChatBubble";
import { MediaMessage } from "../../../components/common/MediaUpload";
import MessageReactions from "../../../components/MessageReactions";
import ChatSessionSection from "../../../components/chat/ChatSessionSection";

type ReplyTarget = {
  username: string;
  timestamp?: string | number | null;
  messageId?: string;
};

type DmMessageListProps = {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  messageRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  renderMessages: Message[];
  useVirtual: boolean;
  virtualizer: Virtualizer<HTMLDivElement, Element> | null;
  highlightedKey: string | null;
  username?: string | null;
  lookupAvatar: (username?: string | null) => string | null;
  keyFor: (message: Message) => string;
  getColorForMessage: (message: Message) => { bg: string; fg: string };
  openActionsFor: (message: Message) => void;
  openReactionPicker: (message: Message) => void;
  buildPressHandlers: (
    message: Message,
    openActions: () => void
  ) => React.HTMLAttributes<HTMLElement>;
  scrollToReferenced: (reply: ReplyTarget) => void;
  handleVoiceNoteDuration: (message: Message, durationMs: number) => void;
  tokenizeTextWithGifs: (text: string) => React.ReactNode;
  AnimatedMedia: React.FC<{
    url: string;
    large?: boolean;
    mediaSources?: {
      mp4?: string;
      webm?: string;
      gif?: string;
      preview?: string;
    };
  }>;
  isGifUrl: (url: string) => boolean;
  isVideoUrl: (url: string) => boolean;
  isImageUrl: (url: string) => boolean;
  truncate: (value: string, max?: number) => string;
  isEmojiOnly: (text?: string) => boolean;
  isConnected: boolean;
  dmId?: string | null;
  onReactionCountClick?: (message: Message) => void;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function getMessageTimestampMs(message: Message): number | null {
  const raw = (message as any)?.timestamp;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function startOfDayMs(timestampMs: number): number {
  const date = new Date(timestampMs);
  const start = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0
  );
  return start.getTime();
}

function formatSessionLabel(timestampMs: number): string {
  const now = Date.now();
  const sessionDate = new Date(timestampMs);
  const todayStart = startOfDayMs(now);
  const sessionStart = startOfDayMs(timestampMs);
  const diffMs = todayStart - sessionStart;

  if (diffMs === 0) {
    return "Today";
  }

  if (diffMs === DAY_MS) {
    return "Yesterday";
  }

  const formatter = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year:
      sessionDate.getFullYear() === new Date(todayStart).getFullYear()
        ? undefined
        : "numeric",
  });

  return formatter.format(sessionDate);
}

function getSessionLabel(message: Message, previous?: Message): string | null {
  const currentTs = getMessageTimestampMs(message);
  if (currentTs == null) return null;
  const currentSessionStart = startOfDayMs(currentTs);

  if (!previous) {
    return formatSessionLabel(currentTs);
  }

  const prevTs = getMessageTimestampMs(previous);
  if (prevTs == null) {
    return formatSessionLabel(currentTs);
  }

  const prevSessionStart = startOfDayMs(prevTs);
  if (currentSessionStart !== prevSessionStart) {
    return formatSessionLabel(currentTs);
  }

  if (currentTs - prevTs >= DAY_MS) {
    return formatSessionLabel(currentTs);
  }

  return null;
}

const DmMessageList: React.FC<DmMessageListProps> = ({
  scrollRef,
  messagesEndRef,
  messageRefs,
  renderMessages,
  useVirtual,
  virtualizer,
  highlightedKey,
  username,
  lookupAvatar,
  keyFor,
  getColorForMessage,
  openActionsFor,
  openReactionPicker,
  buildPressHandlers,
  scrollToReferenced,
  handleVoiceNoteDuration,
  tokenizeTextWithGifs,
  AnimatedMedia,
  isGifUrl,
  isVideoUrl,
  isImageUrl,
  truncate,
  isEmojiOnly,
  isConnected,
  dmId,
  onReactionCountClick,
}) => {
  const listRef = React.useRef<HTMLDivElement>(null);

  const renderSystemNotice = (message: Message, index: number) => (
    <div
      key={message.messageId || message.timestamp || `sys:${index}`}
      className="mb-3 flex justify-center"
    >
      <div className="text-[11px] tracking-wide text-gray-500 select-none">
        {message.text}
      </div>
    </div>
  );

  const renderChatRow = (
    message: Message,
    _index: number,
    msgKey: string,
    prevMessage?: Message
  ) => {
    const chatMsg = message as any;
    const colors = getColorForMessage(message);
    const isStandaloneStructuredMedia = Boolean(
      chatMsg.kind === "media" &&
        chatMsg.media &&
        chatMsg.media.original &&
        !chatMsg.replyTo
    );
    const avatar =
      (typeof chatMsg.avatar === "string" && chatMsg.avatar) ||
      lookupAvatar(message.username) ||
      null;
    const initial = (message.username || "").slice(0, 1).toUpperCase() || "?";
    const sessionLabel = getSessionLabel(message, prevMessage);
    const showEdited = Boolean(chatMsg.edited);

    return (
      <div
        key={msgKey}
        ref={(el) => {
          if (el) {
            messageRefs.current.set(msgKey, el);
          } else {
            messageRefs.current.delete(msgKey);
          }
        }}
        className={
          "mb-2 -mx-4 px-4 relative after:content-[''] after:absolute after:inset-0 after:rounded-md after:bg-gray-200 after:pointer-events-none " +
          "after:transition-opacity after:duration-700 " +
          (highlightedKey === msgKey ? "after:opacity-80" : "after:opacity-0")
        }
      >
        {sessionLabel ? <ChatSessionSection label={sessionLabel} /> : null}
        <div
          className={`flex ${
            message.username === username ? "justify-end" : ""
          }`}
        >
          {message.username !== username && (
            <div className="mr-2 flex-shrink-0 self-end">
              {avatar ? (
                <img
                  src={avatar}
                  alt={`${message.username}'s avatar`}
                  className="h-8 w-8 rounded-full"
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-300 text-xs font-bold text-gray-600">
                  {initial}
                </div>
              )}
            </div>
          )}

          <div
            className={`flex flex-col gap-1 ${
              isStandaloneStructuredMedia
                ? "w-full max-w-full min-w-0"
                : "w-full max-w-[75%] min-w-0"
            } ${message.username === username ? "items-end" : "items-start"}`}
          >
            {showEdited ? (
              <div
                className={`text-[10px] italic opacity-70 ${
                  message.username === username ? "text-right" : "text-left"
                }`}
              >
                Edited
              </div>
            ) : null}

            <ChatBubble
              message={message}
              colors={colors}
              openActionsFor={openActionsFor}
              openReactionsFor={openReactionPicker}
              buildPressHandlers={buildPressHandlers}
              tokenizeTextWithGifs={tokenizeTextWithGifs}
              MediaMessage={MediaMessage}
              AnimatedMedia={AnimatedMedia}
              currentUsername={username}
              onReplyPreviewClick={(reply) =>
                scrollToReferenced({
                  username: reply.username,
                  timestamp: reply.timestamp,
                  messageId: (reply as any).messageId,
                })
              }
              onVoiceNoteDuration={handleVoiceNoteDuration}
              selfAudioAccent
              audioOverrides={
                message.username !== username
                  ? {
                      trackColor: "#d1d5db",
                      progressColor: "#6b7280",
                      buttonIconColor: "#6b7280",
                    }
                  : undefined
              }
              utils={{
                isGifUrl,
                isEmojiOnly,
                isVideoUrl,
                isImageUrl,
                truncate,
              }}
            />
          </div>
        </div>

        <div className="flex">
          {message.username !== username && (
            <div className="w-10 flex-shrink-0" aria-hidden="true" />
          )}
          <div
            className={`flex flex-1 ${
              message.username === username ? "justify-end" : "justify-start"
            }`}
          >
            <div className="w-full max-w-[75%]">
              {!((chatMsg as any).deleted ?? false) && (
                <MessageReactions
                  groupId={dmId || "dm"}
                  message={message}
                  currentUser={username ?? ""}
                  align={message.username === username ? "right" : "left"}
                  hidePicker
                  onCountClick={onReactionCountClick}
                  mode="dm"
                  dmId={dmId || undefined}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const nonVirtualContent = !useVirtual
    ? renderMessages.map((message, index) => {
        if ((message as any).system || message.username === "_system") {
          return renderSystemNotice(message, index);
        }
        const msgKey = keyFor(message);
        const prevMessage = index > 0 ? renderMessages[index - 1] : undefined;
        return renderChatRow(message, index, msgKey, prevMessage);
      })
    : null;

  const virtualizedContent =
    useVirtual && virtualizer
      ? virtualizer.getVirtualItems().map((virtualItem) => {
          const message = renderMessages[virtualItem.index];
          if (!message) return null;

          if ((message as any).system || message.username === "_system") {
            return (
              <div
                key={
                  message.messageId ||
                  message.timestamp ||
                  `sys:${virtualItem.index}`
                }
                data-index={virtualItem.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualItem.start}px)`,
                }}
                ref={(el) => {
                  if (el) virtualizer.measureElement(el);
                }}
              >
                <div className="mb-3 flex justify-center">
                  <div className="text-[11px] tracking-wide text-gray-500 select-none">
                    {message.text}
                  </div>
                </div>
              </div>
            );
          }

          const baseKey = keyFor(message);
          const containerKey = `${baseKey}-${virtualItem.index}`;
          const chatMsg = message as any;
          const colors = getColorForMessage(message);
          const isStandaloneStructuredMedia = Boolean(
            chatMsg.kind === "media" &&
              chatMsg.media &&
              chatMsg.media.original &&
              !chatMsg.replyTo
          );
          const avatar =
            (typeof chatMsg.avatar === "string" && chatMsg.avatar) ||
            lookupAvatar(message.username) ||
            null;
          const initial =
            (message.username || "").slice(0, 1).toUpperCase() || "?";
          const prevMessage =
            virtualItem.index > 0
              ? renderMessages[virtualItem.index - 1]
              : undefined;
          const sessionLabel = getSessionLabel(message, prevMessage);
          const showEdited = Boolean(chatMsg.edited);

          return (
            <div
              key={containerKey}
              data-index={virtualItem.index}
              ref={(el) => {
                if (!el) {
                  messageRefs.current.delete(baseKey);
                  return;
                }
                virtualizer.measureElement(el);
                messageRefs.current.set(baseKey, el);
              }}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItem.start}px)`,
              }}
              className={
                "mb-2 -mx-4 px-4 relative after:content-[''] after:absolute after:inset-0 after:rounded-md after:bg-gray-200 after:pointer-events-none " +
                "after:transition-opacity after:duration-700 " +
                (highlightedKey === baseKey
                  ? "after:opacity-80"
                  : "after:opacity-0")
              }
            >
              {sessionLabel ? (
                <ChatSessionSection label={sessionLabel} />
              ) : null}
              <div
                className={`flex ${
                  message.username === username ? "justify-end" : ""
                }`}
              >
                {message.username !== username && (
                  <div className="mr-2 flex-shrink-0 self-end">
                    {avatar ? (
                      <img
                        src={avatar}
                        alt={`${message.username}'s avatar`}
                        className="h-8 w-8 rounded-full"
                      />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-300 text-xs font-bold text-gray-600">
                        {initial}
                      </div>
                    )}
                  </div>
                )}

                <div
                  className={`flex flex-col gap-1 ${
                    isStandaloneStructuredMedia
                      ? "w-full max-w-full"
                      : "w-full max-w-[75%]"
                  } ${
                    message.username === username ? "items-end" : "items-start"
                  }`}
                >
                  {showEdited ? (
                    <div
                      className={`text-[10px] italic opacity-70 ${
                        message.username === username
                          ? "text-right"
                          : "text-left"
                      }`}
                    >
                      Edited
                    </div>
                  ) : null}

                  <ChatBubble
                    message={message}
                    colors={colors}
                    openActionsFor={openActionsFor}
                    openReactionsFor={openReactionPicker}
                    buildPressHandlers={buildPressHandlers}
                    tokenizeTextWithGifs={tokenizeTextWithGifs}
                    MediaMessage={MediaMessage}
                    AnimatedMedia={AnimatedMedia}
                    currentUsername={username}
                    onReplyPreviewClick={(reply) =>
                      scrollToReferenced({
                        username: reply.username,
                        timestamp: reply.timestamp,
                        messageId: (reply as any).messageId,
                      })
                    }
                    onVoiceNoteDuration={handleVoiceNoteDuration}
                    selfAudioAccent
                    audioOverrides={
                      message.username !== username
                        ? {
                            trackColor: "#d1d5db",
                            progressColor: "#6b7280",
                            buttonIconColor: "#6b7280",
                          }
                        : undefined
                    }
                    utils={{
                      isGifUrl,
                      isEmojiOnly,
                      isVideoUrl,
                      isImageUrl,
                      truncate,
                    }}
                  />
                </div>
              </div>

              <div className="flex">
                {message.username !== username && (
                  <div className="w-10 flex-shrink-0" aria-hidden="true" />
                )}
                <div
                  className={`flex flex-1 ${
                    message.username === username
                      ? "justify-end"
                      : "justify-start"
                  }`}
                >
                  <div className="w-full max-w-[75%]">
                    {!((chatMsg as any).deleted ?? false) && (
                      <MessageReactions
                        groupId={dmId || "dm"}
                        message={message}
                        currentUser={username ?? ""}
                        align={message.username === username ? "right" : "left"}
                        hidePicker
                        onCountClick={onReactionCountClick}
                        mode="dm"
                        dmId={dmId || undefined}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })
      : null;

  const noMessages = isConnected && dmId && renderMessages.length === 0;

  return (
    <div className="flex-1 overflow-y-auto" ref={scrollRef}>
      <div ref={listRef} className="flex flex-col min-h-full px-4 pt-4">
        <div className="grow" aria-hidden="true" />
        {!useVirtual ? nonVirtualContent : null}
        {useVirtual && virtualizer ? (
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: "relative",
            }}
          >
            {virtualizedContent}
          </div>
        ) : null}
        {noMessages ? (
          <div className="py-6 text-center text-sm text-gray-400">
            No messages yet.
          </div>
        ) : null}
        {!isConnected ? (
          <div className="py-6 text-center text-sm text-gray-400">
            Reconnecting…
          </div>
        ) : null}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
};

export default DmMessageList;
