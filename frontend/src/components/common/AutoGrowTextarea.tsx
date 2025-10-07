import React from "react";

type Props = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  maxRows?: number;
};

const AutoGrowTextarea = React.forwardRef<HTMLTextAreaElement, Props>(
  ({ maxRows = 4, style, onInput, ...props }, ref) => {
    const innerRef = React.useRef<HTMLTextAreaElement>(null);

    React.useImperativeHandle(
      ref,
      () => innerRef.current as HTMLTextAreaElement
    );

    const resize = React.useCallback(() => {
      const el = innerRef.current;
      if (!el) return;

      // Reset height to measure correct scrollHeight
      el.style.height = "auto";

      const computed = window.getComputedStyle(el);
      const lineHeightStr = computed.lineHeight;
      const lineHeight =
        parseFloat(lineHeightStr) ||
        parseFloat(computed.fontSize) * 1.2 ||
        16 * 1.2;
      const paddingTop = parseFloat(computed.paddingTop) || 0;
      const paddingBottom = parseFloat(computed.paddingBottom) || 0;
      const borderTop = parseFloat(computed.borderTopWidth) || 0;
      const borderBottom = parseFloat(computed.borderBottomWidth) || 0;

      const maxHeight = Math.ceil(
        lineHeight * maxRows +
          paddingTop +
          paddingBottom +
          borderTop +
          borderBottom
      );
      const newHeight = Math.min(el.scrollHeight, maxHeight);

      el.style.height = `${newHeight}px`;
      el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
    }, [maxRows]);

    React.useEffect(() => {
      resize();
    }, [props.value, resize]);

    React.useEffect(() => {
      const handler = () => resize();
      window.addEventListener("resize", handler);
      return () => window.removeEventListener("resize", handler);
    }, [resize]);

    return (
      <textarea
        {...props}
        ref={innerRef}
        rows={1}
        style={{ ...style, height: "auto" }}
        onInput={(e) => {
          onInput?.(e);
          resize();
        }}
      />
    );
  }
);

AutoGrowTextarea.displayName = "AutoGrowTextarea";
export default AutoGrowTextarea;
