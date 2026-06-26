const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const SRC = 'src/features/discover/screens/CircleDetailScreen.tsx';

test('CircleDetailScreen loads the current user pending invitation for this circle', () => {
  const src = read(SRC);
  assert.match(src, /fetchMyApplications/);
  // Matches the invitation to THIS circle and only while still pending.
  assert.match(src, /inv\.circleId === id/);
  assert.match(src, /inv\.status === 'PENDING'/);
});

test('CircleDetailScreen clears stale invitation state before reloading', () => {
  const src = read(SRC);
  assert.match(src, /invitationRequestRef = useRef\(0\)/);
  assert.match(src, /const requestId = \+\+invitationRequestRef\.current/);
  assert.match(src, /setMyInvitation\(null\);\s*if \(!id\) return;/);
  assert.match(src, /requestId !== invitationRequestRef\.current/);
  assert.match(src, /catch \{[\s\S]*setMyInvitation\(null\);[\s\S]*\}/);
});

test('a PENDING applicant with an invitation gets a verify-entry into the invitation detail', () => {
  const src = read(SRC);
  // The entry is gated on having an invitation, not just PENDING membership.
  assert.match(src, /myInvitation \?/);
  assert.match(src, /pathname: '\/\(tabs\)\/discover\/invitation\/\[id\]'/);
  assert.match(src, /params: \{ id: myInvitation\.id \}/);
  assert.match(src, /circle\.inviteVerifiers/);
});
