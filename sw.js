// Service worker for the installable portal (docs/INSTALLABLE_APP.md). It caches nothing but an offline page, so screens
// and data always come fresh from the server; it shows push notifications and opens the page they point to.
const OFFLINE = '/offline.html';
const CACHE = 'svu-offline-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([OFFLINE, '/src/assets/icons/icon-192.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
// Page loads go to the network; only when that fails is the offline page shown. API calls are never touched.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'South Valley University', body: event.data?.text() || '' }; }
  const link = typeof data.link === 'string' && /^#[A-Za-z0-9_/?=&.%-]{1,200}$/.test(data.link) ? data.link : '#messages';
  event.waitUntil(self.registration.showNotification(data.title || 'South Valley University', {
    body: data.body || '', icon: '/src/assets/icons/icon-192.png', badge: '/src/assets/icons/icon-192.png', tag: data.id || undefined, data: { url: `/${link}` }
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/#messages';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (open) { open.navigate(url); return open.focus(); }
    return self.clients.openWindow(url);
  }));
});
