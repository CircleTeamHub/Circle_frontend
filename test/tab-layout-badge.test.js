const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('tab layout reads badge dots from the unified tab badge store instead of route-driven friend refresh', () => {
  const layout = read('app/(tabs)/_layout.tsx');
  const listeners = read('src/im/listeners.ts');

  assert.match(layout, /useTabBadgeStore/);
  assert.doesNotMatch(layout, /useFriendActivityUnreadStore/);
  assert.doesNotMatch(layout, /refreshUnreadFriendActivityCount/);
  assert.doesNotMatch(layout, /segments\]\);/);
  assert.match(layout, /messagesUnread/);
  assert.match(layout, /contactsUnread/);
  assert.match(layout, /discoverUnread/);
  assert.match(listeners, /useTabBadgeStore/);
  assert.match(listeners, /setMessagesUnread/);
});
