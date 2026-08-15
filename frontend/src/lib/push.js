// Driver-side Web Push helpers: register the service worker, subscribe with the
// server's VAPID key, and report status. Every failure carries a plain message
// the UI can show — including the iPhone-specific "add to Home Screen first".

import { driverApi } from './driverApi';

export function pushSupported() {
  return typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window;
}

export function isIOS() {
  return typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
}

// iOS delivers web push ONLY to a home-screen-installed PWA. This detects that.
export function isStandalone() {
  return (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    (typeof navigator !== 'undefined' && navigator.standalone === true);
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export async function pushStatus() {
  if (!pushSupported()) {
    return { supported: false, iosNeedsInstall: isIOS() && !isStandalone() };
  }
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return { supported: true, enabled: !!sub, permission: Notification.permission };
}

export async function enablePush() {
  if (!pushSupported()) {
    const e = new Error(
      isIOS() && !isStandalone()
        ? 'On iPhone, add RoverZoom to your Home Screen first: tap Share → “Add to Home Screen”, open it from there, then turn on alerts. (You’ll still get a text for new rides in the meantime.)'
        : 'Notifications aren’t supported on this browser.'
    );
    e.code = 'unsupported';
    throw e;
  }

  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    const e = new Error('Notifications are blocked. Enable them in your browser settings to get ride alerts.');
    e.code = 'denied';
    throw e;
  }

  const { configured, key } = await driverApi.getPushKey();
  if (!configured || !key) {
    const e = new Error('Notifications aren’t switched on server-side yet.');
    e.code = 'server';
    throw e;
  }

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
  }
  await driverApi.subscribePush(sub.toJSON());
  return true;
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    await driverApi.unsubscribePush(sub.endpoint).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return true;
}
