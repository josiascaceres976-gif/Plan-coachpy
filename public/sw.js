// Plan Coach: recibe los avisos y abre la app al tocarlos.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'Plan Coach', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Plan Coach', {
    body: d.body || '', icon: '/icon-192.png', badge: '/icon-192.png', data: { url: d.url || '/' }, lang: 'es'
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    const base = url.split('#')[0].split('?')[0];
    for (const w of ws) {
      if (w.url.split('#')[0].split('?')[0] === base && 'focus' in w) { if ('navigate' in w) w.navigate(url); return w.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
