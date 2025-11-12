import React, { useEffect, useMemo, useState } from "react";

const IOSInstallTipBanner: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const isIOS =
    typeof navigator !== "undefined" &&
    /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)")?.matches ||
      (window.navigator as any).standalone);

  useEffect(() => {
    if (!isIOS || isStandalone) return;
    try {
      const pref = localStorage.getItem("pwa_ios_tip_dont_show");
      if (pref === "1") return;
    } catch {}
    setVisible(true);
  }, [isIOS, isStandalone]);

  const isVisible = useMemo(() => visible, [visible]);

  useEffect(() => {
    if (!isVisible) {
      try {
        document.documentElement.style.setProperty(
          "--app-ios-tip-banner-h",
          `0px`
        );
      } catch {}
      return;
    }
    const el = document.querySelector<HTMLDivElement>(".ios-tip-banner-root");
    if (!el) return;
    const setVar = () => {
      const h = el.offsetHeight || 0;
      try {
        document.documentElement.style.setProperty(
          "--app-ios-tip-banner-h",
          `${h}px`
        );
      } catch {}
    };
    setVar();
    const ro = new ResizeObserver(setVar);
    ro.observe(el);
    window.addEventListener("resize", setVar);
    return () => {
      try {
        ro.disconnect();
      } catch {}
      window.removeEventListener("resize", setVar);
    };
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <div
      className="ios-tip-banner-root fixed left-0 right-0 px-4 z-40"
      style={{ bottom: "calc(var(--app-bottomnav-h, 72px) + 16px)" }}
    >
      <div className="mx-auto max-w-md rounded-xl bg-white shadow-lg border border-gray-200 p-3">
        <div className="text-sm text-gray-800">
          Add Funly to your Home Screen for an app-like experience. Tap the
          share icon and choose “Add to Home Screen”.
        </div>
        <div className="mt-3 flex items-center gap-3 justify-end">
          <button
            className="text-sm px-2 py-1.5 rounded-md text-gray-500 hover:text-gray-700"
            onClick={() => setVisible(false)}
            aria-label="Dismiss iOS tip"
          >
            Got it
          </button>
          <button
            className="text-sm px-2 py-1.5 rounded-md text-gray-400 hover:text-gray-600"
            onClick={() => {
              try {
                localStorage.setItem("pwa_ios_tip_dont_show", "1");
              } catch {}
              setVisible(false);
            }}
            aria-label="Don't show iOS tip again"
          >
            Don’t show again
          </button>
        </div>
      </div>
    </div>
  );
};

export default IOSInstallTipBanner;
