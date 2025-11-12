export async function requestInboxPreviewSync() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    // @ts-expect-error: SyncManager may not exist in all browsers
    if (reg.sync && typeof reg.sync.register === "function") {
      // @ts-ignore
      await reg.sync.register("refresh-inbox-previews");
    }
  } catch {
    // ignore: feature may be unavailable
  }
}
