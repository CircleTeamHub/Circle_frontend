const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const src = fs.readFileSync(
  'src/features/contacts/screens/FriendActivityDetailScreen.tsx',
  'utf8',
);

test('friend activity detail renders a message thread with a reply input', () => {
  assert.match(src, /fetchFriendRequestMessages/);
  assert.match(src, /sendFriendRequestMessage/);
  // PENDING gates whether the reply input renders
  assert.match(src, /requestState === 'PENDING'/);
  // reply input
  assert.match(src, /TextInput/);
});

test('friend activity detail aligns bubbles by sender identity', () => {
  // own messages compared against the signed-in user id
  assert.match(src, /senderId === selfUserId/);
});
