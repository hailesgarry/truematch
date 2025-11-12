import { Workbox } from "workbox-window";

export function registerPWA() {
  // Only register the service worker in production to avoid dev HMR conflicts
  if (import.meta.env.DEV) {
    // Extra guard: if any SW is controlling the page (e.g., from earlier run), unregister it.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => {
          regs.forEach((r) => r.unregister());
        })
        .catch(() => {});
    }
    return;
  }
  if ("serviceWorker" in navigator) {
    const wb = new Workbox("/sw.js");
    wb.addEventListener("installed", (event) => {
      if ((event as any).isUpdate) {
        console.info("PWA updated. Reload to apply.");
      }
    });
    wb.register().catch(() => {
      // ignore registration failures in non-critical paths
    });
  }
}

// install prompt handling
let deferred: any = null;
export function captureInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (e: any) => {
    e.preventDefault();
    deferred = e;
    // Notify UI that install can be prompted
    try {
      window.dispatchEvent(new CustomEvent("pwa:caninstall"));
    } catch {}
  });
}

export async function promptInstall(): Promise<boolean> {
  if (deferred) {
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    return outcome === "accepted";
  }
  return false;
}

export function canPromptInstall(): boolean {
  return Boolean(deferred);
}
