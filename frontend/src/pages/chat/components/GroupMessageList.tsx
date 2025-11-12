import React from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import type { Message, MessageReplySummary } from "../../../types";
import type { MediaPreviewMeta } from "../../../components/common/MediaUpload";
import MessageReactions from "../../../components/MessageReactions";
import ChatBubble from "../../../components/chat/ChatBubble";
import UserQuickActions from "../../../components/common/UserQuickActions";
import RelativeTime from "../../../components/common/RelativeTime";
import ScrollRestoration from "../../../components/common/ScrollRestoration";
import AnimatedMedia from "../media";
import { MediaMessage } from "../asyncComponents";
import { RESPONSIVE_BUBBLE_WIDTH } from "../chatConstants";
import {
  messageMentionsUser,
  tokenizeTextWithGifs,
  isGifUrl,
  isVideoUrl,
  isImageUrl,
  truncate,
} from "../text";
import { SystemNotice, isSystemMessage } from "../systemMessages";

type GroupMessageListProps = {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  messageRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  renderMessages: Message[];
  useVirtual: boolean;
  virtualizer: Virtualizer<HTMLDivElement, Element> | null;
  highlightedKey: string | null;
  currentGroupId?: string;
  username?: string | null;
  avatarMap: Record<string, string | null | undefined>;
  keyFor: (message: Message, index?: number) => string;
  getColorForMessage: (message: Message) => { bg: string; fg: string };
  handleMentionNavigate: (username: string) => void;
  isMentionable: (author?: string | null) => boolean;
  handleQuickMention: (username: string) => void;
  openFilterModal: (username: string) => void;
  openActionsFor: (message: Message) => void;
  openReactionPicker: (message: Message) => void;
  buildPressHandlers: (
    message: Message,
    openActions: () => void
  ) => React.HTMLAttributes<HTMLElement>;
  scrollToReferenced: (reply: {
    username: string;
    timestamp?: string | number | null;
    messageId?: string;
  }) => void;
  handleVoiceNoteDuration: (message: Message, durationMs: number) => void;
  resolveMediaOverlayMeta: (message: Message) => MediaPreviewMeta | undefined;
  onReactionCountClick: (message: Message) => void;
  isConnected: boolean;
  isEmojiOnly: (text?: string) => boolean;
};

const GroupMessageList: React.FC<GroupMessageListProps> = ({
  scrollRef,
  messagesEndRef,
  messageRefs,
  renderMessages,
  useVirtual,
  virtualizer,
  highlightedKey,
  currentGroupId,
  username,
  avatarMap,
  keyFor,
  getColorForMessage,
  handleMentionNavigate,
  isMentionable,
  handleQuickMention,
  openFilterModal,
  openActionsFor,
  openReactionPicker,
  buildPressHandlers,
  scrollToReferenced,
  handleVoiceNoteDuration,
  resolveMediaOverlayMeta,
  onReactionCountClick,
  isConnected,
  isEmojiOnly,
}) => {
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
  const scrollRestorationRef = React.useRef<{
    save: () => void;
    restore: () => void;
    reset: () => void;
  } | null>(null);

  React.useEffect(() => {
    scrollRestorationRef.current?.restore();
    return () => {
      // ensure latest position persisted when component unmounts
      scrollRestorationRef.current?.save();
    };
  }, []);

  const renderReplySummary = (
    replySummary:
      | { count: number; samples?: MessageReplySummary[] | null }
      | undefined
  ) => {
    if (!replySummary || replySummary.count <= 0) return null;
    const previewNames =
      replySummary.samples
        ?.map((sample) => sample?.username)
        .filter((name): name is string => Boolean(name))
        .slice(-2) ?? [];
    return (
      <div className="mt-1 text-xs text-gray-500">
        {replySummary.count === 1 ? "1 reply" : `${replySummary.count} replies`}
        {previewNames.length ? ` · ${previewNames.join(", ")}` : null}
      </div>
    );
  };

  const renderChatRow = (message: Message, index: number) => {
    const colors = getColorForMessage(message);
    const msgKey = keyFor(message, index);
    const chatMsg = message as any;
    const isStandaloneStructuredMedia =
      chatMsg.kind === "media" &&
      Boolean(chatMsg.media && chatMsg.media.original) &&
      !chatMsg.replyTo;
    const mentionedYou =
      message.username !== username &&
      messageMentionsUser(message, username || undefined);
    const truncateUsername =
      mentionedYou &&
      typeof message.username === "string" &&
      message.username.length > 16;
    const mentionTokenizer = (text: string) =>
      tokenizeTextWithGifs(text, handleMentionNavigate);

    const avatarLookupKey = (message.username || "").toLowerCase();
    const resolvedAvatar =
      chatMsg.avatar ??
      (typeof avatarMap[avatarLookupKey] === "string"
        ? avatarMap[avatarLookupKey]
        : null);
    const replySummary = (chatMsg as any).replySummary as
      | { count: number; samples?: MessageReplySummary[] }
      | undefined;

    return (
      <div
        key={msgKey}
        ref={(el) => {
          if (el) messageRefs.current.set(msgKey, el);
          else messageRefs.current.delete(msgKey);
        }}
        className={
          "mb-2 -mx-4 px-4 relative after:content-[''] after:absolute after:inset-0 after:rounded-md after:bg-gray-200 after:pointer-events-none " +
          "after:transition-opacity after:duration-700 " +
          (highlightedKey === msgKey ? "after:opacity-80" : "after:opacity-0")
        }
      >
        <div className="flex">
          <div className="flex-shrink-0 mr-2 self-end">
            {resolvedAvatar ? (
              <img
                src={resolvedAvatar}
                alt={`${message.username}'s avatar`}
                className="w-8 h-8 rounded-full"
              />
            ) : (
              <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center text-gray-600 text-xs font-bold">
                {typeof message.username === "string" &&
                message.username.length > 0
                  ? message.username.charAt(0).toUpperCase()
                  : "?"}
              </div>
            )}
          </div>

          <div
            className={`flex flex-col gap-1 ${
              isStandaloneStructuredMedia
                ? "w-full max-w-full"
                : RESPONSIVE_BUBBLE_WIDTH
            } items-start`}
          >
            <div className="flex items-center text-xs justify-start">
              <UserQuickActions
                username={message.username}
                userId={message.userId}
                avatarUrl={(resolvedAvatar ?? undefined) as string | undefined}
                onMention={
                  isMentionable(message.username)
                    ? handleQuickMention
                    : undefined
                }
                onFilterUser={openFilterModal}
              >
                <span
                  className={`text-sm font-medium cursor-pointer ${
                    truncateUsername
                      ? "inline-block max-w-[9rem] truncate align-bottom"
                      : ""
                  }`}
                >
                  {message.username}
                </span>
              </UserQuickActions>
              <RelativeTime
                value={(chatMsg as any).timestamp}
                className="ml-2 text-[11px] text-gray-500"
                withSuffix={false}
                minUnit="minute"
                hideBelowMin={false}
                showJustNowBelowMin
                justNowThresholdMs={60_000}
                fallback=""
              />
              {chatMsg.edited && (
                <span
                  className="ml-1 text-[10px] italic opacity-70"
                  title={
                    chatMsg.lastEditedAt
                      ? `Edited at ${new Date(
                          chatMsg.lastEditedAt
                        ).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}`
                      : "Edited"
                  }
                >
                  (edited)
                </span>
              )}
            </div>

            <ChatBubble
              message={message}
              colors={colors}
              openActionsFor={openActionsFor}
              openReactionsFor={openReactionPicker}
              buildPressHandlers={buildPressHandlers}
              tokenizeTextWithGifs={mentionTokenizer}
              MediaMessage={MediaMessage}
              AnimatedMedia={AnimatedMedia}
              currentUsername={username}
              onReplyPreviewClick={(reply) =>
                scrollToReferenced({
                  username: reply.username,
                  timestamp: reply.timestamp,
                })
              }
              onVoiceNoteDuration={handleVoiceNoteDuration}
              audioOverrides={{
                trackColor: "#d1d5db",
                progressColor: "#6b7280",
                buttonIconColor: "#6b7280",
              }}
              resolveMediaOverlayMeta={resolveMediaOverlayMeta}
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
          <div className="w-10 flex-shrink-0" aria-hidden="true" />
          <div className="flex-1 flex justify-start">
            <div className={RESPONSIVE_BUBBLE_WIDTH}>
              {!chatMsg.deleted && currentGroupId && (
                <div className="flex items-center gap-2">
                  <MessageReactions
                    groupId={currentGroupId}
                    message={message}
                    currentUser={username ?? ""}
                    align="left"
                    hidePicker
                    onCountClick={onReactionCountClick}
                  />
                  {renderReplySummary(replySummary)}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const nonVirtualItems = !useVirtual
    ? renderMessages.flatMap((message, index) => {
        if (isSystemMessage(message as any)) {
          return [
            <SystemNotice
              key={
                (message as any).messageId ||
                (message as any).timestamp ||
                `sys:${index}`
              }
              message={message as any}
            />,
          ];
        }

        return [renderChatRow(message, index)];
      })
    : null;

  const virtualizedItems =
    useVirtual && virtualizer
      ? virtualizer.getVirtualItems().map((virtualItem) => {
          const message = renderMessages[virtualItem.index];
          if (!message) return null;

          if (isSystemMessage(message as any)) {
            return (
              <div
                key={
                  (message as any).messageId ||
                  (message as any).timestamp ||
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
                <SystemNotice message={message as any} />
              </div>
            );
          }

          const msgKey = keyFor(message, virtualItem.index);
          const chatMsg = message as any;
          const avatarLookupKey = (message.username || "").toLowerCase();
          const resolvedAvatar =
            chatMsg.avatar ??
            (typeof avatarMap[avatarLookupKey] === "string"
              ? avatarMap[avatarLookupKey]
              : null);
          const isStandaloneStructuredMedia =
            chatMsg.kind === "media" &&
            Boolean(chatMsg.media && chatMsg.media.original) &&
            !chatMsg.replyTo;
          const mentionedYou =
            message.username !== username &&
            messageMentionsUser(message, username || undefined);
          const truncateUsername =
            mentionedYou &&
            typeof message.username === "string" &&
            message.username.length > 16;
          const mentionTokenizer = (text: string) =>
            tokenizeTextWithGifs(text, handleMentionNavigate);

          const colors = getColorForMessage(message);
          const replySummary = (chatMsg as any).replySummary as
            | { count: number; samples?: MessageReplySummary[] }
            | undefined;

          return (
            <div
              key={msgKey}
              data-index={virtualItem.index}
              ref={(el) => {
                if (el) virtualizer.measureElement(el);
              }}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItem.start}px)`,
              }}
              className={
                "mb-2 -mx-4 px-4 relative after:content-[''] after:absolute after:inset-0 after:rounded-md after:bg-gray-100 after:pointer-events-none " +
                "after:transition-opacity after:duration-700 " +
                (highlightedKey === msgKey
                  ? "after:opacity-80"
                  : "after:opacity-0")
              }
            >
              <div className="flex">
                <div className="flex-shrink-0 mr-2 self-end">
                  {resolvedAvatar ? (
                    <img
                      src={resolvedAvatar}
                      alt={`${message.username}'s avatar`}
                      className="w-8 h-8 rounded-full"
                    />
                  ) : (
                    <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center text-gray-600 text-xs font-bold">
                      {typeof message.username === "string" &&
                      message.username.length > 0
                        ? message.username.charAt(0).toUpperCase()
                        : "?"}
                    </div>
                  )}
                </div>

                <div
                  className={`flex flex-col gap-1 ${
                    isStandaloneStructuredMedia
                      ? "w-full max-w-full"
                      : RESPONSIVE_BUBBLE_WIDTH
                  } items-start`}
                >
                  <div className="flex items-center text-xs justify-start">
                    <UserQuickActions
                      username={message.username}
                      userId={message.userId}
                      avatarUrl={
                        (resolvedAvatar ?? undefined) as string | undefined
                      }
                      onMention={
                        isMentionable(message.username)
                          ? handleQuickMention
                          : undefined
                      }
                      onFilterUser={openFilterModal}
                    >
                      <span
                        className={`text-sm font-medium cursor-pointer ${
                          truncateUsername
                            ? "inline-block max-w-[9rem] truncate align-bottom"
                            : ""
                        }`}
                      >
                        {message.username}
                      </span>
                    </UserQuickActions>
                    <RelativeTime
                      value={(chatMsg as any).timestamp}
                      className="ml-2 text-[11px] text-gray-500"
                      withSuffix={false}
                      minUnit="minute"
                      hideBelowMin={false}
                      showJustNowBelowMin
                      justNowThresholdMs={60_000}
                      fallback=""
                    />
                    {chatMsg.edited && (
                      <span
                        className="ml-1 text-[10px] italic opacity-70"
                        title={
                          chatMsg.lastEditedAt
                            ? `Edited at ${new Date(
                                chatMsg.lastEditedAt
                              ).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}`
                            : "Edited"
                        }
                      >
                        (edited)
                      </span>
                    )}
                  </div>

                  <ChatBubble
                    message={message}
                    colors={colors}
                    openActionsFor={openActionsFor}
                    openReactionsFor={openReactionPicker}
                    buildPressHandlers={buildPressHandlers}
                    tokenizeTextWithGifs={mentionTokenizer}
                    MediaMessage={MediaMessage}
                    AnimatedMedia={AnimatedMedia}
                    currentUsername={username}
                    onReplyPreviewClick={(reply) =>
                      scrollToReferenced({
                        username: reply.username,
                        timestamp: reply.timestamp,
                      })
                    }
                    onVoiceNoteDuration={handleVoiceNoteDuration}
                    audioOverrides={{
                      trackColor: "#d1d5db",
                      progressColor: "#6b7280",
                      buttonIconColor: "#6b7280",
                    }}
                    resolveMediaOverlayMeta={resolveMediaOverlayMeta}
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
                <div className="w-10 flex-shrink-0" aria-hidden="true" />
                <div className="flex-1 flex justify-start">
                  <div className={RESPONSIVE_BUBBLE_WIDTH}>
                    {!chatMsg.deleted && currentGroupId && (
                      <div className="flex items-center gap-2">
                        <MessageReactions
                          groupId={currentGroupId}
                          message={message}
                          currentUser={username ?? ""}
                          align="left"
                          hidePicker
                          onCountClick={onReactionCountClick}
                        />
                        {renderReplySummary(replySummary)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })
      : null;

  return (
    <div
      className="flex-1 overflow-y-auto"
      style={{ paddingTop: "var(--app-header-h, 56px)" }}
      ref={(el) => {
        scrollRef.current = el;
        scrollContainerRef.current = el;
      }}
    >
      <ScrollRestoration
        ref={(instance) => {
          scrollRestorationRef.current = instance;
        }}
        targetRef={scrollContainerRef}
        storageKey={`chatScroll::${currentGroupId ?? "__global__"}`}
        debounceMs={120}
      />
      <div className="flex flex-col min-h-full px-4 pt-4">
        {!useVirtual && <div className="grow" aria-hidden="true" />}
        {nonVirtualItems}
        {useVirtual && virtualizer && (
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: "relative",
            }}
          >
            {virtualizedItems}
          </div>
        )}
        {isConnected && currentGroupId && renderMessages.length === 0 && (
          <div className="text-center text-gray-400 text-sm py-6">
            No messages yet.
          </div>
        )}
        {!useVirtual && <div ref={messagesEndRef} />}
      </div>
    </div>
  );
};

export default GroupMessageList;
