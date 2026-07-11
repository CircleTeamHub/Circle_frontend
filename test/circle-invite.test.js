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
  assert.match(src, /fetchCircleDetail\(circleId\)/);
  assert.match(src, /loadGroupMemberList\(detail\.groupID, 10_000\)/);
  assert.match(src, /filterInvitableCircleFriends/);
  assert.match(src, /inviteToCircle\(circleId, friendId\)/);
  // Fan-out tolerates per-friend rejection (already member / restriction / privacy).
  assert.match(src, /Promise\.allSettled/);
  assert.match(src, /inviteeIds\.map/);
});

test('InviteToCircleScreen supports pull-to-refresh', () => {
  const src = read(
    'src/features/discover/screens/InviteToCircleScreen.tsx',
  );

  assert.match(src, /const \[refreshing, setRefreshing\] = useState\(false\)/);
  assert.match(src, /handleRefreshInvitees/);
  assert.match(src, /mountedRef/);
  assert.match(src, /refreshInFlightRef/);
  assert.match(src, /if \(refreshInFlightRef\.current\) return;/);
  assert.match(src, /signal\?\.cancelled \|\| !mountedRef\.current/);
  assert.match(src, /setRefreshing\(true\)/);
  assert.match(src, /showInitialLoading/);
  assert.match(src, /await loadInvitees\(undefined, \{ showInitialLoading: false \}\)/);
  assert.match(src, /finally\s*\{[\s\S]{0,120}mountedRef\.current[\s\S]{0,80}setRefreshing\(false\)/);
  assert.match(src, /refreshing=\{refreshing\}/);
  assert.match(src, /onRefresh=\{handleRefreshInvitees\}/);
});

test('InviteToCircleScreen stays open when every invite fails', () => {
  const src = read(
    'src/features/discover/screens/InviteToCircleScreen.tsx',
  );

  assert.match(src, /if \(succeeded === 0\) \{/);
  assert.match(src, /circle\.invite\.noneSent/);
  assert.match(src, /return;\s*\n\s*\}/);
});

test('CircleDetailScreen exposes the invite entry to active members', () => {
  const src = read(
    'src/features/discover/screens/CircleDetailScreen.tsx',
  );

  assert.match(src, /const isActiveMember = circle\?\.myStatus === 'ACTIVE'/);
  assert.match(src, /\{isActiveMember \? \(/);
  assert.match(src, /getCircleInviteHref\(\s*circleScope/);
});

test('CircleDetailScreen only exposes group chat to active members', () => {
  const src = read(
    'src/features/discover/screens/CircleDetailScreen.tsx',
  );

  assert.match(src, /const isActiveMember = circle\?\.myStatus === 'ACTIVE'/);
  assert.match(src, /isActiveMember && circle\.groupID \? \(/);
});

test('invite entry is a menu: send circle card + invite contacts', () => {
  const route = read('app/(tabs)/discover/circle/[id]/invite.tsx');
  assert.match(route, /InviteCircleMenuScreen/);

  const menu = read(
    'src/features/discover/screens/InviteCircleMenuScreen.tsx',
  );
  // option 1: send the circle as a chat card (opens the share picker)
  assert.match(menu, /handleSendCard/);
  assert.match(menu, /getCircleShareHref\(circleScope/);
  // option 2: navigates to the friend picker
  assert.match(menu, /getCircleInviteFriendsHref\(circleScope/);
});

test('invite-friends route renders the friend picker', () => {
  const route = read(
    'app/(tabs)/discover/circle/[id]/invite-friends.tsx',
  );
  assert.match(route, /InviteToCircleScreen/);
});
