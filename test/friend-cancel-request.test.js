const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const SRC = 'src/features/contacts/screens/FriendActivityDetailScreen.tsx';

test('FriendActivityDetailScreen wires withdraw to the cancel API', () => {
  const src = read(SRC);

  assert.match(src, /cancelFriendRequest/);
  assert.match(src, /await cancelFriendRequest\(activity\.requestId\)/);
  // After withdrawing, the local state reflects the WITHDRAWN request state.
  assert.match(src, /requestState: 'WITHDRAWN'/);
});

test('FriendActivityDetailScreen only offers withdraw on a pending outgoing request', () => {
  const src = read(SRC);

  assert.match(
    src,
    /canCancelOutgoing\s*=[\s\S]*REQUEST_SENT[\s\S]*requestState === 'PENDING'/,
  );
  assert.match(src, /canCancelOutgoing \? \(/);
  assert.match(src, /onPress=\{handleCancel\}/);
});
