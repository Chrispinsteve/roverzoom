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
        // This previously ended "(You will still get a text for new rides in the
        // meantime.)" — untrue once SMS required consent. A driver who read it
        // would wait for a message that was never coming.
        ? 'On iPhone, add RoverZoom to your Home Screen first: tap Share \u2192 "Add to Home Screen", open it from there, then turn on alerts. In the meantime, switch on "Text me as backup" below.'
        : 'Notifications aren’t supported on this browser.'
    );
    e.code = 'unsupported';
    throw e;
  }

  // Ask for permission FIRST, right on the user's tap — iOS is strict about the
  // prompt happening within the gesture, so do it before any slower awaits.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    const e = new Error('Notifications are blocked. Enable them in your browser settings to get ride alerts.');
    e.code = 'denied';
    throw e;
  }

  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  const { configured, key } = await driverApi.getPushKey();
  if (!configured || !key) {
    const e = new Error('Notifications aren’t switched on server-side yet.');
    e.code = 'server';
    throw e;
  }

  const appServerKey = urlBase64ToUint8Array(String(key).trim());
  // A valid VAPID applicationServerKey is a 65-byte EC point. If it isn't, the
  // key stored on the server is malformed (usually a truncated/whitespaced env
  // value) — fail with a message that points at the real problem.
  if (appServerKey.length !== 65) {
    const e = new Error('The server’s notification key looks malformed — check VAPID_PUBLIC_KEY in the deployment.');
    e.code = 'bad_key';
    throw e;
  }

  // Clear any existing subscription first. A subscription created with a
  // different key (e.g. a previous setup attempt) makes a fresh subscribe fail
  // with "Registration failed - push service error"; unsubscribing avoids that.
  const existing = await reg.pushManager.getSubscription();
  if (existing) await existing.unsubscribe().catch(() => {});

  let sub;
  try {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appServerKey,
    });
  } catch (err) {
    const e = new Error('Your browser couldn’t register for notifications. If this keeps happening, the server notification key may be wrong.');
    e.code = 'subscribe_failed';
    e.cause = err;
    throw e;
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
