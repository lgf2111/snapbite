/*
 * SnapBite service worker: web push, local notifications, and the Android share
 * target.
 *
 * Hand-written and served from the site root on purpose: no bundler plugin, no
 * Workbox. It does not cache the app and intercepts exactly one request: the POST
 * the Android share sheet makes to /share-target (see the fetch handler below). The
 * app works exactly as it did without it otherwise. It exists so the browser has
 * somewhere to deliver a push (iOS 16.4+ does so only for an installed Home Screen
 * app), and somewhere to receive a shared photo.
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

/*
 * Share target. Sharing a photo to SnapBite from Android's share sheet makes the
 * browser POST multipart/form-data to /share-target (see manifest.webmanifest). A
 * page cannot receive a POST, so this worker does: it parks the photo in the Cache
 * API under a fixed key and answers with a redirect to /?shared=1, where the app
 * picks it up (src/lib/shareTarget.ts) and runs it through the normal capture flow.
 * Keep the cache name and keys in step with that file.
 */
const SHARE_CACHE = 'snapbite-share';
const SHARE_PHOTO_KEY = '/__share__/photo';

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'POST') return;
  if (new URL(request.url).pathname !== '/share-target') return;

  event.respondWith(
    (async () => {
      try {
        const form = await request.formData();
        const photo = form.get('photo');
        // A share can be text only (a link, a caption): then there is nothing to log,
        // and the app says so.
        if (photo && typeof photo !== 'string') {
          const cache = await caches.open(SHARE_CACHE);
          // Read the bytes explicitly: a Response built from a File is fine in a
          // browser, but this keeps the body plain and byte-exact everywhere.
          await cache.put(
            SHARE_PHOTO_KEY,
            new Response(await photo.arrayBuffer(), {
              headers: {
                'content-type': photo.type || 'image/jpeg',
                // A filename can be any Unicode: header values cannot. Encode it (see
                // shareTarget.ts for the matching decode).
                'x-filename': encodeURIComponent(photo.name || 'shared.jpg'),
              },
            }),
          );
        }
      } catch {
        // Fall through to the redirect: the app reports an empty share.
      }
      // 303: the browser follows a POST with a GET, so the app loads normally.
      return Response.redirect(new URL('/?shared=1', self.location.origin).href, 303);
    })(),
  );
});
