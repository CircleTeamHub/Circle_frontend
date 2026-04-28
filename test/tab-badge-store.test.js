const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('tab badge store exposes realtime unread state and realtime config url', () => {
  const store = read('src/stores/tabBadgeStore.ts');
  const config = read('src/constants/config.ts');

  assert.match(config, /REALTIME_WS_URL/);
  assert.match(store, /messagesUnread/);
  assert.match(store, /contactsUnread/);
  assert.match(store, /discoverUnread/);
  assert.match(store, /profileUnread/);
  assert.match(store, /setMessagesUnread/);
  assert.match(store, /setContactsUnread/);
  assert.match(store, /setDiscoverUnread/);
  assert.match(store, /applySnapshot/);
  assert.match(store, /setRealtimeConnected/);
  assert.match(store, /reset/);
});
