import React, { useEffect, useMemo, useState } from "react";
import { promptInstall, canPromptInstall } from "../../pwa";

const InstallBanner: React.FC = () => {
  const [canInstall, setCanInstall] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [dontShow, setDontShow] = useState(false);

  const isIOS =
    typeof navigator !== "undefined" &&
    /iphone|ipad|ipod/i.test(navigator.userAgent);

  useEffect(() => {
    try {
      const pref = localStorage.getItem("pwa_install_dont_show");
      if (pref === "1") setDontShow(true);
    } catch {}
    const markAvailable = () => setCanInstall(true);
    window.addEventListener("pwa:caninstall", markAvailable);
    if (canPromptInstall()) setCanInstall(true);
    return () => window.removeEventListener("pwa:caninstall", markAvailable);
  }, []);

  const visible = useMemo(
    () => !(dismissed || dontShow || isIOS || !canInstall),
    [dismissed, dontShow, isIOS, canInstall]
  );

  // Publish banner height CSS var so layout can account for it
  useEffect(() => {
    if (!visible) {
      try {
        document.documentElement.style.setProperty(
          "--app-install-banner-h",
          `0px`
        );
      } catch {}
      return;
    }
    const el = document.querySelector<HTMLDivElement>(".install-banner-root");
    if (!el) return;
    const setVar = () => {
      const h = el.offsetHeight || 0;
      try {
        document.documentElement.style.setProperty(
          "--app-install-banner-h",
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
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="install-banner-root fixed left-0 right-0 px-4 z-40"
      style={{ bottom: "calc(var(--app-bottomnav-h, 72px) + 16px)" }}
    >
      <div className="mx-auto max-w-md rounded-xl bg-white shadow-lg border border-gray-200 p-3">
        <div className="text-sm text-gray-800">
          Install Funly for a faster, app-like experience.
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 sm:gap-3 w-full">
          <button
            className="text-xs sm:text-sm px-3 py-1.5 rounded-md bg-sky-600 text-white whitespace-nowrap"
            onClick={async () => {
              const ok = await promptInstall();
              if (ok) setDismissed(true);
            }}
          >
            Install
          </button>
          <button
            className="text-xs sm:text-sm px-2 py-1.5 rounded-md text-gray-500 hover:text-gray-700 whitespace-nowrap"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss install banner"
          >
            Dismiss
          </button>
          <button
            className="text-xs sm:text-sm px-2 py-1.5 rounded-md text-gray-400 hover:text-gray-600 whitespace-nowrap"
            onClick={() => {
              try {
                localStorage.setItem("pwa_install_dont_show", "1");
              } catch {}
              setDontShow(true);
            }}
            aria-label="Don't show again"
          >
            Don’t show again
          </button>
        </div>
      </div>
    </div>
  );
};

export default InstallBanner;
