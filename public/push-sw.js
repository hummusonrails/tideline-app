/* eslint-disable no-undef */
/**
 * Push handlers, imported into the Workbox-generated service worker via
 * `workbox.importScripts` in vite.config.ts.
 *
 * It lives here rather than in a hand-written `injectManifest` service worker
 * on purpose: the generated SW already handles precaching, navigation
 * fallback and the network-only rule for the data backend, and rewriting all
 * of that by hand to add two event listeners would put working offline
 * behaviour at risk for no gain.
 *
 * Payloads are JSON, encrypted end-to-end by the sender (the notifier
 * workflow) against this device's subscription keys:
 *   { title, body, tag, url }
 */

const FALLBACK = {
  title: 'Tideline',
  body: 'Something new in the app.',
  tag: 'tideline',
  url: '/tideline-app/',
};

self.addEventListener('push', (event) => {
  let data = FALLBACK;
  try {
    if (event.data) data = { ...FALLBACK, ...event.data.json() };
  } catch {
    // Malformed or empty payload — iOS still requires a visible notification
    // for every push, so fall through with the generic copy rather than
    // returning early and burning the permission.
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      // Same tag collapses repeats: ten chat messages leave one entry in the
      // notification centre instead of ten.
      tag: data.tag,
      renotify: true,
      icon: '/tideline-app/icons/icon-192.png',
      badge: '/tideline-app/icons/icon-192.png',
      data: { url: data.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || FALLBACK.url;

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // Prefer focusing an already-open window and steering it, so tapping a
      // notification never opens a second copy of the app.
      for (const client of clientList) {
        if (client.url.includes('/tideline-app/') && 'focus' in client) {
          await client.focus();
          if ('navigate' in client) await client.navigate(target).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
