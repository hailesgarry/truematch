import React from "react";
import type { Message } from "../../types";
import type { MessageLike } from "./types";

export function isSystemMessage(message: MessageLike): boolean {
  if (!message) return false;
  if (message.system === true) return true;
  if (typeof message.systemType === "string" && message.systemType.length > 0)
    return true;
  const username =
    typeof message.username === "string" ? message.username.toLowerCase() : "";
  return username === "system" || username === "_system";
}

export function systemDisplayText(message: MessageLike): string {
  const raw = typeof message.text === "string" ? message.text.trim() : "";
  if (raw) return raw;

  const type = (message.systemType || message.type || message.event || "")
    .toString()
    .toLowerCase();

  const actor =
    (message.actor && (message.actor.username || message.actor.name)) ||
    (Array.isArray(message.users) && message.users[0]) ||
    (Array.isArray(message.usernames) && message.usernames[0]) ||
    (message.target && (message.target.username || message.target.name)) ||
    (typeof message.username === "string" &&
    message.username.toLowerCase() !== "system"
      ? message.username
      : "Someone");

  if (type === "join") return `${actor} joined`;
  if (type === "leave" || type === "left") return `${actor} left`;
  if (type) return `System: ${type}`;
  return "System message";
}

export const SystemNotice: React.FC<{ message: Message | MessageLike }> = ({
  message,
}) => {
  const text = systemDisplayText(message || {});
  return (
    <div className="my-2 flex justify-center">
      <div className="text-gray-500 text-xs select-none">{text}</div>
    </div>
  );
};
