import React from "react";
import NProgress from "nprogress";
import "nprogress/nprogress.css";

type NProgressBarProps = {
  active: boolean;
  showSpinner?: boolean;
  color?: string;
  height?: number;
  minimum?: number;
  trickleSpeed?: number;
};

// Controlled wrapper that syncs NProgress with React state
const NProgressBar: React.FC<NProgressBarProps> = ({
  active,
  showSpinner = false,
  color = "#2563eb",
  height = 3,
  minimum = 0.08,
  trickleSpeed = 200,
}) => {
  const startedRef = React.useRef(false);

  React.useEffect(() => {
    NProgress.configure({
      showSpinner,
      minimum,
      trickleSpeed,
    });
  }, [showSpinner, minimum, trickleSpeed]);

  React.useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const styleId = "nprogress-custom-style";
    const existing = document.getElementById(styleId);
    const styleElement = existing ?? document.createElement("style");
    styleElement.id = styleId;
    styleElement.textContent = `
      #nprogress .bar {
        background: ${color};
        height: ${height}px;
      }
      #nprogress .peg {
        box-shadow: 0 0 10px ${color}, 0 0 5px ${color};
      }
      #nprogress .spinner-icon {
        border-top-color: ${color};
        border-left-color: ${color};
      }
    `;
    if (!existing) {
      document.head.appendChild(styleElement);
    }
  }, [color, height]);

  React.useEffect(() => {
    if (active) {
      if (!startedRef.current) {
        NProgress.start();
        startedRef.current = true;
      }
    } else if (startedRef.current) {
      NProgress.done();
      startedRef.current = false;
    }
  }, [active]);

  React.useEffect(() => {
    return () => {
      if (startedRef.current) {
        NProgress.done();
        startedRef.current = false;
      } else {
        NProgress.remove();
      }
    };
  }, []);

  return null;
};

export default NProgressBar;
