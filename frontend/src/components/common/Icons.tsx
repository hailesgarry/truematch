import React from "react";

// Base interface for all icon props
interface IconProps {
  size?: number; // Add this line
  width?: string | number;
  height?: string | number;
  className?: string;
  color?: string;
  strokeWidth?: string | number;
  weight?: "regular" | "fill" | "bold"; // Add "bold" to weight
  gradient?: string; // ID of gradient to use instead of solid color
}

// Heart icon
export const Heart: React.FC<IconProps> = ({
  size = 24,
  width,
  height,
  className,
  color = "currentColor",
  strokeWidth = 20,
  weight = "regular",
  gradient,
}) => {
  const fillColor = gradient ? `url(#${gradient})` : color;

  if (weight === "fill") {
    // Fill version
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 256 256"
        width={width || size}
        height={height || size}
        className={className}
      >
        <rect width="256" height="256" fill="none" />
        {gradient && (
          <defs>
            <linearGradient id={gradient} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#e91e8c" />
              <stop offset="30%" stopColor="#d41f8e" />
              <stop offset="50%" stopColor="#ca209e" />
              <stop offset="70%" stopColor="#c820c8" />
              <stop offset="100%" stopColor="#b521d4" />
            </linearGradient>
          </defs>
        )}
        <path
          d="M240,102c0,70-103.79,126.66-108.21,129a8,8,0,0,1-7.58,0C119.79,228.66,16,172,16,102A62.07,62.07,0,0,1,78,40c20.65,0,38.73,8.88,50,23.89C139.27,48.88,157.35,40,178,40A62.07,62.07,0,0,1,240,102Z"
          fill={fillColor}
        />
      </svg>
    );
  }
  // Regular (stroke) version
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      width={width || size}
      height={height || size}
      className={className}
    >
      <rect width="256" height="256" fill="none" />
      {gradient && (
        <defs>
          <linearGradient id={gradient} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#e91e8c" />
            <stop offset="30%" stopColor="#d41f8e" />
            <stop offset="50%" stopColor="#ca209e" />
            <stop offset="70%" stopColor="#c820c8" />
            <stop offset="100%" stopColor="#b521d4" />
          </linearGradient>
        </defs>
      )}
      <path
        d="M128,224S24,168,24,102A54,54,0,0,1,78,48c22.59,0,41.94,12.31,50,32,8.06-19.69,27.41-32,50-32a54,54,0,0,1,54,54C232,168,128,224,128,224Z"
        fill="none"
        stroke={fillColor}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </svg>
  );
};

// Flame icon
export const Flame: React.FC<IconProps> = ({
  size = 24,
  width,
  height,
  className,
  color = "currentColor",
  strokeWidth = 20,
  weight = "regular",
  gradient,
}) => {
  const fillColor = gradient ? `url(#${gradient})` : color;

  if (weight === "fill") {
    // Fill version
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 256 256"
        width={width || size}
        height={height || size}
        className={className}
      >
        <rect width="256" height="256" fill="none" />
        {gradient && (
          <defs>
            <linearGradient id={gradient} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#e91e8c" />
              <stop offset="30%" stopColor="#d41f8e" />
              <stop offset="50%" stopColor="#ca209e" />
              <stop offset="70%" stopColor="#c820c8" />
              <stop offset="100%" stopColor="#b521d4" />
            </linearGradient>
          </defs>
        )}
        <path
          d="M143.38,17.85a8,8,0,0,0-12.63,3.41l-22,60.41L84.59,58.26a8,8,0,0,0-11.93.89C51,87.53,40,116.08,40,144a88,88,0,0,0,176,0C216,84.55,165.21,36,143.38,17.85Z"
          fill={fillColor}
        />
      </svg>
    );
  }
  // Regular (stroke) version
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      width={width || size}
      height={height || size}
      className={className}
    >
      <rect width="256" height="256" fill="none" />
      {gradient && (
        <defs>
          <linearGradient id={gradient} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#e91e8c" />
            <stop offset="30%" stopColor="#d41f8e" />
            <stop offset="50%" stopColor="#ca209e" />
            <stop offset="70%" stopColor="#c820c8" />
            <stop offset="100%" stopColor="#b521d4" />
          </linearGradient>
        </defs>
      )}
      <path
        d="M112,96l26.27-72C159.86,41.92,208,88.15,208,144a80,80,0,0,1-160,0c0-30.57,14.42-58.26,31-80Z"
        fill="none"
        stroke={fillColor}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </svg>
  );
};

// Chat icon
export const Chat: React.FC<IconProps> = ({
  size = 24,
  width,
  height,
  className,
  color = "currentColor",
  strokeWidth = 20,
  weight = "regular",
  gradient,
}) => {
  const fillColor = gradient ? `url(#${gradient})` : color;

  if (weight === "fill") {
    // Fill version
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 256 256"
        width={width || size}
        height={height || size}
        className={className}
      >
        <rect width="256" height="256" fill="none" />
        {gradient && (
          <defs>
            <linearGradient id={gradient} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#e91e8c" />
              <stop offset="30%" stopColor="#d41f8e" />
              <stop offset="50%" stopColor="#ca209e" />
              <stop offset="70%" stopColor="#c820c8" />
              <stop offset="100%" stopColor="#b521d4" />
            </linearGradient>
          </defs>
        )}
        <path
          d="M232,128A104,104,0,0,1,79.12,219.82L45.07,231.17a16,16,0,0,1-20.24-20.24l11.35-34.05A104,104,0,1,1,232,128Z"
          fill={fillColor}
        />
      </svg>
    );
  }
  // Regular (stroke) version
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      width={width || size}
      height={height || size}
      className={className}
    >
      <rect width="256" height="256" fill="none" />
      {gradient && (
        <defs>
          <linearGradient id={gradient} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#e91e8c" />
            <stop offset="30%" stopColor="#d41f8e" />
            <stop offset="50%" stopColor="#ca209e" />
            <stop offset="70%" stopColor="#c820c8" />
            <stop offset="100%" stopColor="#b521d4" />
          </linearGradient>
        </defs>
      )}
      <path
        d="M79.93,211.11a96,96,0,1,0-35-35h0L32.42,213.46a8,8,0,0,0,10.12,10.12l37.39-12.47Z"
        fill="none"
        stroke={fillColor}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </svg>
  );
};

// Plus icon
export const Plus: React.FC<IconProps> = ({
  size = 24,
  width,
  height,
  className,
  color = "currentColor",
  strokeWidth = 20,
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 256 256"
    width={width || size}
    height={height || size}
    className={className}
  >
    <rect width="256" height="256" fill="none" />
    <line
      x1="40"
      y1="128"
      x2="216"
      y2="128"
      fill="none"
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
    />
    <line
      x1="128"
      y1="40"
      x2="128"
      y2="216"
      fill="none"
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
    />
  </svg>
);

// Menu/Hamburger icon
export const Menu: React.FC<IconProps> = ({
  size = 24,
  width,
  height,
  className,
  color = "currentColor",
  strokeWidth = 20,
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 256 256"
    width={width || size}
    height={height || size}
    className={className}
  >
    <rect width="256" height="256" fill="none" />
    <line
      x1="40"
      y1="88" // Changed from 96 to 88 (moved up)
      x2="200"
      y2="88" // Changed from 96 to 88 (moved up)
      fill="none"
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
    />
    <line
      x1="40"
      y1="168" // Changed from 160 to 168 (moved down)
      x2="150"
      y2="168" // Changed from 160 to 168 (moved down)
      fill="none"
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
    />
  </svg>
);

// Refresh icon
export const Refresh: React.FC<IconProps> = ({
  size = 24,
  width,
  height,
  className,
  color = "currentColor",
  strokeWidth = 20,
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 256 256"
    width={width || size}
    height={height || size}
    className={className}
  >
    <rect width="256" height="256" fill="none" />
    <polyline
      points="24 56 24 104 72 104"
      fill="none"
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
    />
    <path
      d="M67.59,192A88,88,0,1,0,65.77,65.77L24,104"
      fill="none"
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
    />
  </svg>
);

// Home icon
export const Home: React.FC<IconProps> = ({
  size = 24,
  width,
  height,
  className,
  color = "currentColor",
  strokeWidth = 20,
  weight = "regular",
  gradient,
}) => {
  const fillColor = gradient ? `url(#${gradient})` : color;

  if (weight === "fill") {
    // Fill version
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 256 256"
        width={width || size}
        height={height || size}
        className={className}
      >
        <rect width="256" height="256" fill="none" />
        {gradient && (
          <defs>
            <linearGradient id={gradient} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#e91e8c" />
              <stop offset="30%" stopColor="#d41f8e" />
              <stop offset="50%" stopColor="#ca209e" />
              <stop offset="70%" stopColor="#c820c8" />
              <stop offset="100%" stopColor="#b521d4" />
            </linearGradient>
          </defs>
        )}
        <path
          d="M224,120v96a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V120a15.87,15.87,0,0,1,4.69-11.32l80-80a16,16,0,0,1,22.62,0l80,80A15.87,15.87,0,0,1,224,120Z"
          fill={fillColor}
        />
      </svg>
    );
  }
  // Regular (stroke) version
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      width={width || size}
      height={height || size}
      className={className}
    >
      <rect width="256" height="256" fill="none" />
      {gradient && (
        <defs>
          <linearGradient id={gradient} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#e91e8c" />
            <stop offset="30%" stopColor="#d41f8e" />
            <stop offset="50%" stopColor="#ca209e" />
            <stop offset="70%" stopColor="#c820c8" />
            <stop offset="100%" stopColor="#b521d4" />
          </linearGradient>
        </defs>
      )}
      <path
        d="M40,216H216V120a8,8,0,0,0-2.34-5.66l-80-80a8,8,0,0,0-11.32,0l-80,80A8,8,0,0,0,40,120Z"
        fill="none"
        stroke={fillColor}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </svg>
  );
};

// Bell icon
export const Bell: React.FC<IconProps> = ({
  size = 24,
  width,
  height,
  className,
  color = "currentColor",
  strokeWidth = 20,
  weight = "regular",
  gradient,
}) => {
  const fillColor = gradient ? `url(#${gradient})` : color;

  if (weight === "fill") {
    // Fill version
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 256 256"
        width={width || size}
        height={height || size}
        className={className}
      >
        <rect width="256" height="256" fill="none" />
        {gradient && (
          <defs>
            <linearGradient id={gradient} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#e91e8c" />
              <stop offset="30%" stopColor="#d41f8e" />
              <stop offset="50%" stopColor="#ca209e" />
              <stop offset="70%" stopColor="#c820c8" />
              <stop offset="100%" stopColor="#b521d4" />
            </linearGradient>
          </defs>
        )}
        <path
          d="M168,224a8,8,0,0,1-8,8H96a8,8,0,1,1,0-16h64A8,8,0,0,1,168,224Zm53.81-48.06C216.25,166.38,208,139.33,208,104a80,80,0,1,0-160,0c0,35.34-8.26,62.38-13.81,71.94A16,16,0,0,0,48,200H208a16,16,0,0,0,13.8-24.06Z"
          fill={fillColor}
        />
      </svg>
    );
  }
  // Regular (stroke) version
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      width={width || size}
      height={height || size}
      className={className}
    >
      <rect width="256" height="256" fill="none" />
      {gradient && (
        <defs>
          <linearGradient id={gradient} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#e91e8c" />
            <stop offset="30%" stopColor="#d41f8e" />
            <stop offset="50%" stopColor="#ca209e" />
            <stop offset="70%" stopColor="#c820c8" />
            <stop offset="100%" stopColor="#b521d4" />
          </linearGradient>
        </defs>
      )}
      <line
        x1="96"
        y1="224"
        x2="160"
        y2="224"
        fill="none"
        stroke={fillColor}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <path
        d="M56,104a72,72,0,0,1,144,0c0,35.82,8.3,64.6,14.9,76A8,8,0,0,1,208,192H48a8,8,0,0,1-6.88-12C47.71,168.6,56,139.81,56,104Z"
        fill="none"
        stroke={fillColor}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </svg>
  );
};

// Chat/Message bubble icon
export const ChatBubble: React.FC<IconProps> = ({
  size = 24,
  width,
  height,
  className,
  color = "currentColor",
  strokeWidth = 20,
  weight = "regular",
  gradient,
}) => {
  const fillColor = gradient ? `url(#${gradient})` : color;

  if (weight === "fill") {
    // Fill version
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 256 256"
        width={width || size}
        height={height || size}
        className={className}
      >
        <rect width="256" height="256" fill="none" />
        {gradient && (
          <defs>
            <linearGradient id={gradient} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#e91e8c" />
              <stop offset="30%" stopColor="#d41f8e" />
              <stop offset="50%" stopColor="#ca209e" />
              <stop offset="70%" stopColor="#c820c8" />
              <stop offset="100%" stopColor="#b521d4" />
            </linearGradient>
          </defs>
        )}
        <path
          d="M232,56V184a16,16,0,0,1-16,16H155.57l-13.68,23.94a16,16,0,0,1-27.78,0L100.43,200H40a16,16,0,0,1-16-16V56A16,16,0,0,1,40,40H216A16,16,0,0,1,232,56Z"
          fill={fillColor}
        />
      </svg>
    );
  }
  // Regular (stroke) version
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      width={width || size}
      height={height || size}
      className={className}
    >
      <rect width="256" height="256" fill="none" />
      {gradient && (
        <defs>
          <linearGradient id={gradient} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#e91e8c" />
            <stop offset="30%" stopColor="#d41f8e" />
            <stop offset="50%" stopColor="#ca209e" />
            <stop offset="70%" stopColor="#c820c8" />
            <stop offset="100%" stopColor="#b521d4" />
          </linearGradient>
        </defs>
      )}
      <path
        d="M105.07,192l16,28a8,8,0,0,0,13.9,0l16-28H216a8,8,0,0,0,8-8V56a8,8,0,0,0-8-8H40a8,8,0,0,0-8,8V184a8,8,0,0,0,8,8Z"
        fill="none"
        stroke={fillColor}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </svg>
  );
};

// User icon
export const User: React.FC<IconProps> = ({
  size = 24,
  width,
  height,
  className,
  color = "currentColor",
  strokeWidth = 20,
  weight = "regular",
  gradient,
}) => {
  const fillColor = gradient ? `url(#${gradient})` : color;

  if (weight === "fill") {
    // Fill version
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 256 256"
        width={width || size}
        height={height || size}
        className={className}
      >
        <rect width="256" height="256" fill="none" />
        {gradient && (
          <defs>
            <linearGradient id={gradient} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#e91e8c" />
              <stop offset="30%" stopColor="#d41f8e" />
              <stop offset="50%" stopColor="#ca209e" />
              <stop offset="70%" stopColor="#c820c8" />
              <stop offset="100%" stopColor="#b521d4" />
            </linearGradient>
          </defs>
        )}
        <path
          d="M230.93,220a8,8,0,0,1-6.93,4H32a8,8,0,0,1-6.92-12c15.23-26.33,38.7-45.21,66.09-54.16a72,72,0,1,1,73.66,0c27.39,8.95,50.86,27.83,66.09,54.16A8,8,0,0,1,230.93,220Z"
          fill={fillColor}
        />
      </svg>
    );
  }
  // Regular (stroke) version
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      width={width || size}
      height={height || size}
      className={className}
    >
      <rect width="256" height="256" fill="none" />
      {gradient && (
        <defs>
          <linearGradient id={gradient} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#e91e8c" />
            <stop offset="30%" stopColor="#d41f8e" />
            <stop offset="50%" stopColor="#ca209e" />
            <stop offset="70%" stopColor="#c820c8" />
            <stop offset="100%" stopColor="#b521d4" />
          </linearGradient>
        </defs>
      )}
      <circle
        cx="128"
        cy="96"
        r="64"
        fill="none"
        stroke={fillColor}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <path
        d="M32,216c19.37-33.47,54.55-56,96-56s76.63,22.53,96,56"
        fill="none"
        stroke={fillColor}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </svg>
  );
};
