/* Minebeat HQ — reçoit les notifications (Web Push), même quand l'app est fermée. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Minebeat HQ', {
    body: d.body || 'Quelque chose est à traiter',
    icon: 'icon-512.png',
    badge: 'icon-512.png',
    tag: d.tag || undefined,
    data: { url: d.url || './' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (url.startsWith(self.location.origin) || url.startsWith('./')) {
      for (const w of wins) { await w.focus(); return; }
    }
    await self.clients.openWindow(url);
  })());
});
