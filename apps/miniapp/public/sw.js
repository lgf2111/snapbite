/*
 * SnapBite service worker: web push, nothing else.
 *
 * Hand-written and served from the site root on purpose: no bundler plugin, no
 * Workbox. It does not cache anything and does not intercept fetches; the app
 * works exactly as it did without it. It exists so the browser has somewhere to
 * deliver a push (iOS 16.4+ does so only for an installed Home Screen app).
 */

self.addEventListener('install', () => {
  // A new worker takes over straight away: there is no cache to migrate.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/** `{ title, body, url, tag }` from the server; anything missing gets a safe default. */
function readPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch {
    return { body: event.data.text() };
  }
}

self.addEventListener('push', (event) => {
  const data = readPayload(event);
  // Every push must show a notification (userVisibleOnly); iOS revokes the
  // subscription of an app that receives pushes and shows nothing.
  event.waitUntil(
    self.registration.showNotification(data.title || 'SnapBite', {
      body: data.body || '',
      tag: data.tag,
      icon: '/icon-192.png',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // Prefer the window that is already open.
      for (const client of windows) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

function base64UrlToBytes(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

// The browser rotated or expired the subscription: get a new one and tell the server.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      let key = event.oldSubscription?.options.applicationServerKey;
      if (!key) {
        const res = await fetch('/api/push/key', { credentials: 'include' });
        key = base64UrlToBytes((await res.json()).key);
      }
      const subscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
      await fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      });
    })(),
  );
});
