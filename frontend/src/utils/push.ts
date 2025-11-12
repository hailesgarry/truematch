import { pythonApi } from "../services/api";

// Helper: convert base64 url-safe string to Uint8Array
function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function getVapidPublicKey(): Promise<string | null> {
  const fromEnv = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (fromEnv && typeof fromEnv === "string" && fromEnv.length > 10)
    return fromEnv;
  try {
    const res = await pythonApi.get<{ key: string | null }>("/push/public-key");
    return res.data?.key || null;
  } catch {
    return null;
  }
}

export async function ensurePushPermission(): Promise<NotificationPermission> {
  if (!("Notification" in window)) return "denied";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  return await Notification.requestPermission();
}

export async function subscribeUserToPush(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window))
    return null;
  const permission = await ensurePushPermission();
  if (permission !== "granted") return null;
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  const vapidKey = await getVapidPublicKey();
  if (!vapidKey) return null;
  try {
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });
    return sub;
  } catch {
    return null;
  }
}

export async function registerSubscriptionOnServer(
  sub: PushSubscription
): Promise<boolean> {
  try {
    await pythonApi.post("/push/subscribe", sub.toJSON());
    return true;
  } catch {
    return false;
  }
}

export async function unsubscribeFromPush(
  sub: PushSubscription
): Promise<void> {
  try {
    await pythonApi.post("/push/unsubscribe", sub.toJSON());
  } catch {}
  try {
    await sub.unsubscribe();
  } catch {}
}

// Convenience: ensure subscription (requests permission if needed)
export async function ensurePushSubscription(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await subscribeUserToPush();
    if (!sub) return false;
  }
  return registerSubscriptionOnServer(sub);
}
