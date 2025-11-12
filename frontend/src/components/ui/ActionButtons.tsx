import React from "react";
import clsx from "clsx";

export interface ActionButtonsProps {
  primaryText?: string;
  secondaryText?: string;
  onSecondary?: () => void;
  primaryDisabled?: boolean;
  hidePrimary?: boolean;
  primaryType?: "button" | "submit";
  secondaryType?: "button" | "submit";
  className?: string;
  variant?: "double" | "primary" | "secondary";
  size?: "sm" | "md" | "lg";
  secondaryDisabled?: boolean;
  stretchButtons?: boolean;
}

const ActionButtons: React.FC<ActionButtonsProps> = ({
  primaryText = "Save",
  secondaryText = "Cancel",
  onSecondary,
  primaryDisabled = false,
  hidePrimary = false,
  primaryType = "submit",
  secondaryType = "button",
  className,
  variant = "double",
  size = "md",
  secondaryDisabled = false,
  stretchButtons,
}) => {
  const sizeClasses = {
    sm: "px-3 py-2 text-sm",
    md: "px-4 py-3 text-sm",
    lg: "px-5 py-4 text-base",
  } as const;

  const commonPrimaryClasses =
    "rounded-md bg-primary-gradient font-semibold text-white focus:outline-none disabled:cursor-not-allowed disabled:opacity-60";
  const commonSecondaryClasses =
    "rounded-md bg-gray-100 font-medium text-gray-700 focus:outline-none";
  const shouldStretch =
    typeof stretchButtons === "boolean" ? stretchButtons : true;
  const widthClass = shouldStretch
    ? variant === "double"
      ? "flex-1"
      : "w-full"
    : undefined;

  const showPrimary = variant !== "secondary";
  const showSecondary = variant !== "primary" && !!secondaryText;
  const shouldShowPrimary = showPrimary && !hidePrimary;

  return (
    <div
      className={clsx(
        "flex gap-3",
        variant !== "double" && "justify-end",
        className
      )}
    >
      {showSecondary ? (
        <button
          type={secondaryType}
          onClick={onSecondary}
          className={clsx(
            widthClass,
            commonSecondaryClasses,
            sizeClasses[size]
          )}
          disabled={secondaryDisabled}
        >
          {secondaryText}
        </button>
      ) : null}
      {shouldShowPrimary ? (
        <button
          type={primaryType}
          className={clsx(widthClass, commonPrimaryClasses, sizeClasses[size])}
          disabled={primaryDisabled}
        >
          {primaryText}
        </button>
      ) : null}
    </div>
  );
};

export default ActionButtons;
