import React from "react";

type Props = {
  visible: boolean;
  peerName?: string;
  onPick: (text: string) => void;
  onClose: () => void;
};

const baseSuggestions = [
  "👋 Hey!",
  "You look awesome ✨",
  "How are you? 🙂",
  "Nice to meet you! 🙌",
  "Want to grab coffee? ☕",
];

const MessageSuggestions: React.FC<Props> = ({
  visible,
  peerName,
  onPick,
  onClose,
}) => {
  if (!visible) return null;

  const items = React.useMemo(() => {
    const name = peerName?.trim();
    const extras = name ? [`Hi ${name}! 👋`, `Hey ${name}, what’s up?`] : [];
    const uniq = Array.from(new Set([...extras, ...baseSuggestions]));
    return uniq;
  }, [peerName]);

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-gray-600">
          Quick suggestions
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-gray-500 hover:text-gray-700"
          aria-label="Hide suggestions"
        >
          Hide
        </button>
      </div>
      <div
        className="flex gap-2 overflow-x-auto pb-1"
        role="listbox"
        aria-label="Message suggestions"
      >
        {items.map((text, i) => (
          <button
            key={`${text}-${i}`}
            type="button"
            onClick={() => onPick(text)}
            className="shrink-0 px-3 py-1.5 rounded-full bg-gray-100 hover:bg-gray-200 text-sm text-gray-800 border border-gray-200"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
};

export default MessageSuggestions;
