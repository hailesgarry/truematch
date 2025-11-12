import React from "react";
import type { CSSProperties } from "react";

interface FunlyLogoProps {
  size?: "small" | "medium" | "large";
}

const FunlyLogo: React.FC<FunlyLogoProps> = ({ size = "medium" }) => {
  const sizeClasses = {
    small: "text-xl",
    medium: "text-2xl",
    large: "text-4xl",
  };

  const styles = {
    logoContainer: {
      display: "inline-flex",
      alignItems: "center",
      gap: 0,
      cursor: "pointer",
      transition: "transform 0.2s ease",
      position: "relative",
    } as CSSProperties,

    logoText: {
      fontFamily: "'Plus Jakarta Sans', sans-serif",
      lineHeight: 1,
      position: "relative",
      zIndex: 1,
      fontOpticalSizing: "auto",
      WebkitFontSmoothing: "antialiased",
      MozOsxFontSmoothing: "grayscale",
    } as CSSProperties,

    // colors/weights handled via Tailwind classes on spans
  };

  // Create hover effects with React
  const [isHovered, setIsHovered] = React.useState(false);

  const containerStyle = {
    ...styles.logoContainer,
    transform: isHovered ? "scale(1.03)" : "scale(1)",
  };

  // Fine-tuned font sizes per size prop
  const fontSizeMap: Record<NonNullable<FunlyLogoProps["size"]>, number> = {
    small: 20,
    medium: 28,
    large: 36,
  };

  return (
    <div
      style={containerStyle}
      className={sizeClasses[size]}
      aria-label="truematch logo"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Logo Text */}
      <div style={{ ...styles.logoText, fontSize: `${fontSizeMap[size]}px` }}>
        <span className="text-slate-800 font-bold tracking-tighter">true</span>
        <span className="text-slate-800 font-bold tracking-tight">match</span>
      </div>
    </div>
  );
};

export default FunlyLogo;
