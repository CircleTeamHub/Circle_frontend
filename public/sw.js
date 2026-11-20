/* WindNote's notification worker does not intercept requests or cache account data. */
self.addEventListener('push', (event) => {
  event.waitUntil(self.registration.showNotification('风信', {
    body: '你有一条新消息',
    icon: '/icons/windnote-192.png',
    tag: 'windnote-chat',
    renotify: true,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.focus();
    } else {
      await self.clients.openWindow('/');
    }
  })());
});
