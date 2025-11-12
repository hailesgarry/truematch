import React from "react";

type LoadingSpinnerProps = {
  size?: number; // pixel size for the spinner diameter
  label?: string; // accessible label for screen readers
  className?: string; // container className
};

// A11y-friendly rotating spinner styled with Tailwind's red-500
const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 24,
  label = "Loading",
  className = "",
}) => {
  const style: React.CSSProperties = {
    width: size,
    height: size,
    borderWidth: Math.max(2, Math.round(size / 8)),
  };

  return (
    <div
      className={["inline-flex items-center", className].join(" ")}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span
        className="inline-block rounded-full border-current border-t-transparent animate-spin text-red-500"
        style={style}
        aria-hidden="true"
      />
      <span className="sr-only">{label}</span>
    </div>
  );
};

export default LoadingSpinner;
