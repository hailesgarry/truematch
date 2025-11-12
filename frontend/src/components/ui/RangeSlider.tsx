import React from "react";
import clsx from "clsx";
import * as SliderPrimitive from "@radix-ui/react-slider";

export type RangeSliderProps = {
  id?: string;
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  onValueChange?: (value: [number, number]) => void;
  onValueCommit?: (value: [number, number]) => void;
  disabled?: boolean;
  className?: string;
  thumbClassName?: string;
  trackClassName?: string;
  rangeClassName?: string;
  ariaLabels?: [string, string];
  ariaLabelledBy?: string;
};

const RangeSlider = React.forwardRef<HTMLSpanElement, RangeSliderProps>(
  (
    {
      min,
      max,
      step = 1,
      value,
      onValueChange,
      onValueCommit,
      disabled = false,
      className,
      thumbClassName,
      trackClassName,
      rangeClassName,
      ariaLabels,
      id,
      ariaLabelledBy,
    },
    ref
  ) => {
    const handleChange = (next: number[]) => {
      if (next.length < 2) return;
      onValueChange?.([next[0], next[1]]);
    };

    const handleCommit = (next: number[]) => {
      if (next.length < 2) return;
      onValueCommit?.([next[0], next[1]]);
    };

    return (
      <SliderPrimitive.Root
        ref={ref}
        id={id}
        min={min}
        max={max}
        step={step}
        value={value}
        onValueChange={handleChange}
        onValueCommit={handleCommit}
        disabled={disabled}
        minStepsBetweenThumbs={0}
        aria-labelledby={ariaLabelledBy}
        className={clsx(
          "relative flex w-full touch-none select-none items-center",
          disabled && "opacity-60",
          className
        )}
      >
        <SliderPrimitive.Track
          className={clsx(
            "relative h-2 w-full rounded-full bg-gray-200",
            trackClassName
          )}
        >
          <SliderPrimitive.Range
            className={clsx(
              "absolute h-full rounded-full bg-red-500",
              rangeClassName
            )}
          />
        </SliderPrimitive.Track>
        {[0, 1].map((index) => (
          <SliderPrimitive.Thumb
            key={index}
            aria-label={ariaLabels?.[index]}
            className={clsx(
              "block h-5 w-5 rounded-full border border-white bg-red-500 shadow-sm transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500",
              "data-[state=active]:scale-110",
              thumbClassName
            )}
          >
            <span className="sr-only">
              {ariaLabels?.[index] ??
                (index === 0 ? "Minimum value" : "Maximum value")}
            </span>
          </SliderPrimitive.Thumb>
        ))}
      </SliderPrimitive.Root>
    );
  }
);

RangeSlider.displayName = "RangeSlider";

export default RangeSlider;
