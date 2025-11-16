import React from "react";
import type { Message } from "../../types";
import { extractLinks } from "../../utils/links";
import AnimatedMedia, { isGifUrl, isVideoUrl, isImageUrl } from "./media";

export const truncate = (s: string, max = 80) =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s;

export function tokenizeMentions(
  text: string,
  onMentionClick?: (username: string) => void
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /@([A-Za-z0-9_]{1,32})/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));

    const full = match[0];
    const username = match[1] ?? "";
    const clickable = typeof onMentionClick === "function";

    const interactiveProps = clickable
      ? {
          role: "button" as const,
          tabIndex: 0,
          onClick: (event: React.MouseEvent<HTMLSpanElement>) => {
            event.preventDefault();
            event.stopPropagation();
            onMentionClick?.(username);
          },
          onKeyDown: (event: React.KeyboardEvent<HTMLSpanElement>) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              onMentionClick?.(username);
            }
          },
          onPointerDown: (event: React.PointerEvent<HTMLSpanElement>) => {
            event.stopPropagation();
          },
        }
      : {};

    parts.push(
      <span
        key={`mention-${match.index}`}
        className={"text-blue-600" + (clickable ? " cursor-pointer" : "")}
        {...interactiveProps}
      >
        {full}
      </span>
    );
    last = match.index + full.length;
  }

  if (last < text.length) {
    parts.push(text.slice(last));
  }

  return parts;
}

export function messageMentionsUser(
  message: Partial<Message> & Record<string, any>,
  targetUsername?: string | null
): boolean {
  if (!targetUsername) return false;
  const text = typeof message.text === "string" ? message.text : "";
  if (!text || !text.includes("@")) return false;

  const lowerTarget = targetUsername.toLowerCase();
  const mentionRegex = /@([A-Za-z0-9_]{1,32})/g;
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(text)) !== null) {
    if (match[1]?.toLowerCase() === lowerTarget) {
      return true;
    }
  }

  return false;
}

export function tokenizeTextWithGifs(
  text: string,
  onMentionClick?: (username: string) => void
): React.ReactNode[] {
  const links = extractLinks(text);

  const renderSegment = (
    segment: string,
    keyPrefix: string
  ): React.ReactNode[] => {
    if (!segment) return [];
    const pieces = segment.split(/(\s+)/);

    return pieces.map((piece, index) => {
      if (isGifUrl(piece)) {
        return <AnimatedMedia key={`${keyPrefix}-gif-${index}`} url={piece} />;
      }

      if (/[@]/.test(piece)) {
        return (
          <React.Fragment key={`${keyPrefix}-mention-${index}`}>
            {tokenizeMentions(piece, onMentionClick)}
          </React.Fragment>
        );
      }

      return (
        <React.Fragment key={`${keyPrefix}-text-${index}`}>
          {piece}
        </React.Fragment>
      );
    });
  };

  if (!links.length) {
    return renderSegment(text, "segment");
  }

  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  links.forEach((link, index) => {
    if (link.index > cursor) {
      const before = text.slice(cursor, link.index);
      nodes.push(...renderSegment(before, `before-${index}`));
    }

    const isGif = isGifUrl(link.url);

    if (isGif) {
      nodes.push(<AnimatedMedia key={`link-gif-${index}`} url={link.url} />);
      if (link.suffix) {
        nodes.push(
          <React.Fragment key={`link-gif-suffix-${index}`}>
            {link.suffix}
          </React.Fragment>
        );
      }
    } else {
      nodes.push(
        <React.Fragment key={`link-${index}`}>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="break-words text-blue-700 underline decoration-blue-500 decoration-1 underline-offset-2 transition hover:text-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            {link.display}
          </a>
          {link.suffix ? link.suffix : null}
        </React.Fragment>
      );
    }

    cursor = link.index + link.length;
  });

  if (cursor < text.length) {
    const tail = text.slice(cursor);
    nodes.push(...renderSegment(tail, "tail"));
  }

  return nodes;
}

export { isGifUrl, isVideoUrl, isImageUrl };
