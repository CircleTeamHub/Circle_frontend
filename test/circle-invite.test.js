const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('InviteToCircleScreen invites selected friends via inviteToCircle', () => {
  const src = read(
    'src/features/discover/screens/InviteToCircleScreen.tsx',
  );

  assert.match(src, /fetchFriends/);
  assert.match(src, /inviteToCircle\(circleId, friendId\)/);
  // Fan-out tolerates per-friend rejection (already member / restriction / privacy).
  assert.match(src, /Promise\.allSettled/);
  assert.match(src, /selectedIds\.map/);
});

test('CircleDetailScreen exposes the invite entry to active members', () => {
  const src = read(
    'src/features/discover/screens/CircleDetailScreen.tsx',
  );

  assert.match(src, /circle\.myStatus === 'ACTIVE' \?/);
  assert.match(src, /circle\/\[id\]\/invite/);
});

test('invite route re-exports InviteToCircleScreen', () => {
  const src = read('app/(tabs)/discover/circle/[id]/invite.tsx');
  assert.match(src, /InviteToCircleScreen/);
});
