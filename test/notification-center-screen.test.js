const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const readScreen = () =>
  fs.readFileSync(
    path.join(
      process.cwd(),
      'src/features/notifications/screens/NotificationCenterScreen.tsx',
    ),
    'utf8',
  );

test('notification center does not replace failed fetches with empty notification data', () => {
  const source = readScreen();

  assert.doesNotMatch(source, /fetchNotifications\(1\)\.catch\(\(\) => \[\]\)/);
  assert.doesNotMatch(source, /catch\(\(\) => \[\] as MyCirclePost\[\]\)/);
  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /fetchAllMyCirclePosts\(\)/);
  assert.doesNotMatch(source, /fetchMyCirclePosts\(1\)/);
  assert.match(source, /setLoadError\(/);
  assert.match(source, /notifications\.loadFailed/);
});

test('notification center refreshes after mark-all failures instead of swallowing them', () => {
  const source = readScreen();

  assert.doesNotMatch(source, /markAllNotificationsRead\(\)\.catch/);
  assert.doesNotMatch(source, /markMyPostSignupsRead\(id\)\.catch/);
  assert.match(source, /const previousInteractive = store\(\)\.interactive/);
  assert.match(source, /const previousSignupPosts = store\(\)\.signupPosts/);
  assert.match(source, /await load\(\)/);
});

test('interactive notification taps delegate to the shared notification route resolver', () => {
  const source = readScreen();

  assert.match(source, /useSegments/);
  assert.match(source, /notificationScope/);
  assert.match(source, /getSnackbarRoute/);
  assert.match(source, /scope: notificationScope/);
  assert.match(source, /router\.push\(route\)/);
  assert.doesNotMatch(source, /其余互动通知仅标记已读/);
});

test('notification center keeps circle signup navigation in the current tab stack', () => {
  const source = readScreen();

  assert.match(source, /pathname:\s*notificationScope === 'discover'\s*\?\s*'\/\(tabs\)\/discover\/post-signups'\s*:\s*'\/\(tabs\)\/messages\/post-signups'/);
  assert.doesNotMatch(source, /pathname: '\/\(tabs\)\/messages\/post-signups'/);
});

test('notification center keeps the bell badge in sync when interactive items are read', () => {
  const source = readScreen();

  assert.match(source, /const previousDiscoverUnread = useTabBadgeStore\.getState\(\)\.discoverUnread/);
  assert.match(source, /setDiscoverUnread\(0\)/);
  assert.match(source, /setDiscoverUnread\(previousDiscoverUnread\)/);
  assert.match(source, /if \(!raw\.read\)/);
  assert.match(source, /Math\.max\(0, badgeStore\.discoverUnread - 1\)/);
  // systemUnread 已整体删除（#103）——这里不允许再出现对它的读写。
  assert.doesNotMatch(source, /systemUnread/i);
});
