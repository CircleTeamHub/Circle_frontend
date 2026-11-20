/* WindNote's notification worker does not intercept requests or cache account data. */
// The push payload carries no content, so the alert is fixed copy. It mirrors the
// app's brand name per locale and chat.snackbarNewMessage in src/i18n/locales.
const ALERT_COPY = {
  zh: { title: '风信', body: '新消息' },
  en: { title: 'WindNote', body: 'New message' },
  ja: { title: '風信', body: '新着メッセージ' },
  ko: { title: 'WindNote', body: '새 메시지' },
  es: { title: 'WindNote', body: 'Mensaje nuevo' },
};

function alertCopy() {
  const language = String((self.navigator && self.navigator.language) || '').toLowerCase();
  return ALERT_COPY[language.split('-')[0]] || ALERT_COPY.zh;
}

self.addEventListener('push', (event) => {
  const { title, body } = alertCopy();
  event.waitUntil(self.registration.showNotification(title, {
    body,
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
