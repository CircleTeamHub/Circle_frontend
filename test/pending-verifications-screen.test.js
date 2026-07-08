const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const SCREEN = 'src/features/discover/screens/PendingVerificationsScreen.tsx';
const ROUTE = 'app/(tabs)/discover/verifications.tsx';
const DISCOVER = 'src/features/discover/screens/DiscoverScreen.tsx';

test('PendingVerificationsScreen lists the current user pending verifications', () => {
  const src = read(SCREEN);
  assert.match(src, /fetchMyPendingVerifications/);
  // shows applicant + circle + approved/required progress
  assert.match(src, /item\.applicant\.nickname/);
  assert.match(src, /item\.approvedCount\}\/\{item\.requiredCount/);
});

test('PendingVerificationsScreen supports pull-to-refresh', () => {
  const src = read(SCREEN);

  assert.match(src, /const \[refreshing, setRefreshing\] = useState\(false\)/);
  assert.match(src, /handleRefreshVerifications/);
  assert.match(src, /const mountedRef = useRef\(true\)/);
  assert.match(src, /mountedRef\.current = false/);
  assert.match(src, /refreshInFlightRef/);
  assert.match(src, /if \(refreshInFlightRef\.current\) return;/);
  assert.match(src, /setRefreshing\(true\)/);
  assert.match(src, /await load\(\)/);
  assert.match(src, /if \(mountedRef\.current\) setRefreshing\(false\)/);
  assert.match(src, /refreshing=\{refreshing\}/);
  assert.match(src, /onRefresh=\{handleRefreshVerifications\}/);
});

test('PendingVerificationsScreen routes into the respond screen', () => {
  const src = read(SCREEN);
  assert.match(src, /pathname: '\/\(tabs\)\/discover\/verification\/\[id\]'/);
  assert.match(src, /params: \{ id: item\.id \}/);
});

test('verifications route re-exports the screen', () => {
  const src = read(ROUTE);
  assert.match(src, /PendingVerificationsScreen/);
});

test('Discover header does not expose a pending-verifications entry', () => {
  const src = read(DISCOVER);
  assert.doesNotMatch(src, /handlePendingVerificationsPress/);
  assert.doesNotMatch(src, /["'`]\/\(tabs\)\/discover\/verifications["'`]/);
  assert.doesNotMatch(src, /name="shield-checkmark-outline"/);
});

test('Discover header opens notification center inside the discover stack', () => {
  const src = read(DISCOVER);
  const route = read('app/(tabs)/discover/notification-center.tsx');
  assert.match(src, /useTabBadgeStore/);
  assert.match(src, /const discoverUnread = useTabBadgeStore\(\(state\) => state\.systemUnread\)/);
  assert.match(src, /handleOpenNotifications/);
  assert.match(src, /["'`]\/\(tabs\)\/discover\/notification-center["'`]/);
  assert.doesNotMatch(src, /["'`]\/\(tabs\)\/messages\/notifications["'`]/);
  assert.match(route, /NotificationCenterScreen/);
  assert.match(src, /name="notifications-outline"/);
  assert.match(src, /<Badge count=\{discoverUnread\} \/>/);
});
