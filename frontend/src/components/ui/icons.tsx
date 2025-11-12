import React from "react";

export const ArrowDownIcon: React.FC<{ size?: number; className?: string }> = ({
  size = 24,
  className = "",
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    width={size}
    height={size}
    className={className}
    aria-hidden="true"
  >
    <path d="M12 3a1 1 0 0 1 1 1v11.586l3.293-3.293a1 1 0 1 1 1.414 1.414l-5 5a1 1 0 0 1-1.414 0l-5-5a1 1 0 0 1 1.414-1.414L11 15.586V4a1 1 0 0 1 1-1z" />
  </svg>
);
