const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const src = fs.readFileSync('src/services/api/friends.ts', 'utf8');

test('friends api exposes friend-request message thread endpoints', () => {
  assert.match(src, /export type FriendRequestMessage/);
  assert.match(src, /export async function fetchFriendRequestMessages/);
  assert.match(src, /export async function sendFriendRequestMessage/);
  assert.match(src, /\/friend\/requests\/\$\{[^}]+\}\/messages/);
});

test('server-error-codes whitelists the friend-request message limit code', () => {
  const codes = fs.readFileSync(
    'src/services/api/server-error-codes.ts',
    'utf8',
  );
  assert.match(codes, /'FRIEND_REQUEST_MESSAGE_LIMIT'/);
  assert.match(codes, /'FRIEND_REQUEST_MESSAGE_INVALID'/);
});
