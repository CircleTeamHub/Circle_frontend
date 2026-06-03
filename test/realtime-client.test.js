const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('realtime client routes websocket badge events into the unified tab badge store', () => {
  const client = read('src/realtime/client.ts');

  assert.match(client, /REALTIME_WS_URL/);
  assert.match(client, /new WebSocket/);
  assert.match(client, /badge\.snapshot/);
  assert.match(client, /friend\.activity\.unread\.changed/);
  assert.match(client, /circle\.activity\.unread\.changed/);
  assert.match(client, /applySnapshot/);
  assert.match(client, /setContactsUnread/);
  assert.match(client, /setDiscoverUnread/);
  assert.match(client, /setRealtimeConnected/);
});

test('session bootstrap and logout wire realtime connection lifecycle to auth state', () => {
  const bootstrap = read('src/components/app/session-bootstrap.tsx');
  const session = read('src/services/auth/session.ts');
  const realtime = read('src/realtime/client.ts');
  const friendUnreadStore = read('src/stores/friendActivityUnreadStore.ts');

  assert.match(bootstrap, /connectRealtime/);
  assert.match(bootstrap, /disconnectRealtime/);
  assert.match(bootstrap, /hasHydrated/);
  assert.match(bootstrap, /accessToken/);

  // session.ts no longer imports disconnectRealtime directly; realtime
  // client registers itself via registerLogoutHandler so session.ts can
  // invoke handlers without a circular import.
  assert.match(session, /registerLogoutHandler/);
  assert.match(realtime, /registerLogoutHandler\(disconnectRealtime\)/);
  assert.match(session, /useTabBadgeStore/);
  assert.match(session, /reset\(\)/);

  assert.match(friendUnreadStore, /useTabBadgeStore/);
  assert.match(friendUnreadStore, /setContactsUnread/);
});
