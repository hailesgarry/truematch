import React from "react";

export type ChatSessionSectionProps = {
  label: string;
};

const ChatSessionSection: React.FC<ChatSessionSectionProps> = ({ label }) => {
  return (
    <div className="py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">
      <span className="inline-flex items-center gap-2">
        <span className="h-px w-8 bg-gray-200" aria-hidden="true" />
        <span>{label}</span>
        <span className="h-px w-8 bg-gray-200" aria-hidden="true" />
      </span>
    </div>
  );
};

export default ChatSessionSection;
