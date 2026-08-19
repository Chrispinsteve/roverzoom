// RoverZoom service worker — receives ride-request push notifications and
// opens the driver app when one is tapped. Deliberately minimal: no offline
// caching (the app is online-only), just push handling.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }

  const title = data.title || 'RoverZoom';
  const options = {
    body: data.body || 'New ride request',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'ride-request',
    renotify: true,             // re-alert (sound/buzz) on each new push, not silently replace
    requireInteraction: true,   // stays until the driver acts on it
    silent: false,              // play the device's notification sound (iOS + Android)
    vibrate: [220, 90, 220],    // buzz on Android (iOS ignores; uses its own haptic)
    data: { url: data.url || '/?driver=1' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/?driver=1';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // Focus an existing tab if one is open, else open a new one.
      for (const client of list) {
        if ('focus' in client) {
          if ('navigate' in client) { try { client.navigate(url); } catch (e) { /* ignore */ } }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return undefined;
    })
  );
});
