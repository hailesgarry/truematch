import React from "react";

type FunlyLogoProps = {
  size?: "small" | "medium" | "large";
  color?: string;
};

const FunlyLogo: React.FC<FunlyLogoProps> = ({
  size = "medium",
  color = "linear-gradient(135deg, #833AB4, #FD1D1D, #FCAF45)",
}) => {
  // Size mappings based on the requested size
  const sizeClass = {
    small: "text-xl",
    medium: "text-3xl",
    large: "text-5xl",
  }[size];

  // Container size mappings
  const containerSize = {
    small: "h-8",
    medium: "h-10",
    large: "h-16",
  }[size];

  return (
    <div className={`flex items-center ${containerSize}`}>
      {/* The script-style logo text */}
      <h1
        className={`${sizeClass} font-script`}
        style={{
          fontFamily: "'Pacifico', 'Dancing Script', cursive",
          background: color,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
        }}
      >
        Funly
      </h1>
    </div>
  );
};

export default FunlyLogo;
