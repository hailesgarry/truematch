import React from "react";

type TypingIndicatorProps = {
  active?: boolean;
  label?: string;
  className?: string;
  dotClassName?: string;
  ariaLabel?: string;
};

const TypingIndicator: React.FC<TypingIndicatorProps> = ({
  active = false,
  label,
  className,
  dotClassName,
  ariaLabel,
}) => {
  const hasLabel = typeof label === "string" && label.trim().length > 0;

  if (!active) {
    if (!label) return null;
    return <span className={className}>{label}</span>;
  }

  return (
    <span
      className={`inline-flex items-center gap-1 ${className || ""}`.trim()}
      role="status"
      aria-live="polite"
      aria-label={ariaLabel || label || "Typing"}
    >
      {hasLabel ? <span>{label}</span> : null}
      <span
        className="typing-indicator-dots"
        aria-hidden="true"
        style={{ marginLeft: hasLabel ? undefined : 0 }}
      >
        <span className={`typing-indicator-dot ${dotClassName || ""}`.trim()} />
        <span className={`typing-indicator-dot ${dotClassName || ""}`.trim()} />
        <span className={`typing-indicator-dot ${dotClassName || ""}`.trim()} />
      </span>
    </span>
  );
};

export default TypingIndicator;
