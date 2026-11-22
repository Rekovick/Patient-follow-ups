/*
 * Retired. The follow-up app used to live at the site root with its offline helper here.
 * It moved to app/ (with its own helper), so this one deletes the old saved copy of the app,
 * unregisters itself, and sends any window still showing the old address on to app/.
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.indexOf('surgery-followups-shell-') === 0).map(k => caches.delete(k)));
    await self.registration.unregister();
    const root = new URL('./', self.location).pathname;
    for (const client of await self.clients.matchAll({ type: 'window' })) {
      const url = new URL(client.url);
      if (url.pathname === root || url.pathname === root + 'index.html') client.navigate(root + 'app/' + url.hash);
    }
  })());
});
