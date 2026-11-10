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

const { loadTsModule } = require('./helpers/load-ts-module');
for (const version of [undefined, 1000]) {
  test('stale or legacy snapshot preserves plaza state/version but applies other badges: ' + version, () => {
    const { useTabBadgeStore } = loadTsModule('src/stores/tabBadgeStore.ts');
    useTabBadgeStore.getState().setCirclePlazaHasUpdate(true, 2000);
    useTabBadgeStore.getState().applySnapshot({ circlePlazaHasUpdate: false, circlePlazaChangedAt: version, contactsUnread: 7 });
    const state = useTabBadgeStore.getState();
    assert.equal(state.circlePlazaHasUpdate, true);
    assert.equal(state.circlePlazaChangedAt, 2000);
    assert.equal(state.contactsUnread, 7);
  });
}
test('first legacy snapshot applies and a newer semantic snapshot advances plaza state atomically', () => {
  const { useTabBadgeStore } = loadTsModule('src/stores/tabBadgeStore.ts');
  useTabBadgeStore.getState().applySnapshot({ circlePlazaHasUpdate: true });
  assert.equal(useTabBadgeStore.getState().circlePlazaHasUpdate, true);
  useTabBadgeStore.getState().applySnapshot({ circlePlazaHasUpdate: false, circlePlazaChangedAt: 3000 });
  assert.equal(useTabBadgeStore.getState().circlePlazaHasUpdate, false);
  assert.equal(useTabBadgeStore.getState().circlePlazaChangedAt, 3000);
  useTabBadgeStore.getState().applySnapshot({ signupUnread: 3 });
  assert.equal(useTabBadgeStore.getState().circlePlazaChangedAt, 3000);
});
