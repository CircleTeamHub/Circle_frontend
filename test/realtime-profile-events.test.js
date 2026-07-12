const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('realtime client handles profile, wallet, and system-notification websocket events', () => {
  const client = read('src/realtime/client.ts');
  const store = read('src/stores/tabBadgeStore.ts');

  assert.match(client, /membership\.status\.changed/);
  assert.match(client, /wallet\.balance\.changed/);
  assert.match(client, /wallet\.recharge\.completed/);
  assert.match(client, /system\.notification\.unread\.changed/);
  assert.match(client, /user\.profile\.summary\.changed/);
  assert.match(client, /setProfileUnread/);
  assert.match(client, /fetchNotificationUnreadSummary/);
  assert.match(store, /profileUnread/);
});

test('profile and wallet screens consume realtime notification helpers', () => {
  const profile = read('src/features/profile/screens/ProfileScreen.tsx');
  const systemAnnouncements = read(
    'src/features/profile/screens/SystemAnnouncementsScreen.tsx',
  );
  const wallet = read('src/features/profile/screens/WalletScreen.tsx');
  const notificationsApi = read('src/services/api/notifications.ts');

  assert.doesNotMatch(profile, /markProfileNotificationsRead/);
  assert.match(systemAnnouncements, /markProfileNotificationsRead/);
  assert.match(systemAnnouncements, /setProfileUnread\(0\)/);
  assert.match(wallet, /useWalletRealtimeStore/);
  assert.match(wallet, /realtimeBalance/);
  assert.match(notificationsApi, /fetchNotificationUnreadSummary/);
  assert.match(notificationsApi, /markProfileNotificationsRead/);
});
