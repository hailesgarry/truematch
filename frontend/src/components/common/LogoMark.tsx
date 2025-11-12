import React from "react";

export interface LogoMarkProps {
  size?: number; // pixels
  rounded?: number; // corner radius in px for the background tile
  withBackground?: boolean; // whether to render a background tile behind the rings
}

const BACKGROUND_FILL = "transparent";

/**
 * Brand mark consisting of two interlocking rings.
 */
const LogoMark = React.forwardRef<SVGSVGElement, LogoMarkProps>(
  ({ size = 128, rounded = 28, withBackground = false }, ref) => {
    return (
      <svg
        ref={ref}
        width={size}
        height={size}
        viewBox="0 0 128 128"
        role="img"
        aria-label="truematch interlocking rings logo"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient
            id="leftRingGradient"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="0%"
          >
            <stop offset="0%" stopColor="#e91e8c" />
            <stop offset="100%" stopColor="#d41f8e" />
          </linearGradient>
          <linearGradient
            id="rightRingGradient"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="0%"
          >
            <stop offset="0%" stopColor="#c820c8" />
            <stop offset="100%" stopColor="#b521d4" />
          </linearGradient>
        </defs>

        {withBackground && (
          <rect
            x="0"
            y="0"
            width="128"
            height="128"
            rx={rounded}
            fill={BACKGROUND_FILL}
          />
        )}

        {/* Left ring */}
        <circle
          cx="50"
          cy="64"
          r="34"
          fill="none"
          stroke="url(#leftRingGradient)"
          strokeWidth="10"
          strokeLinecap="round"
        />

        {/* Right ring */}
        <circle
          cx="78"
          cy="64"
          r="34"
          fill="none"
          stroke="url(#rightRingGradient)"
          strokeWidth="10"
          strokeLinecap="round"
        />
      </svg>
    );
  }
);

LogoMark.displayName = "LogoMark";

export default LogoMark;
