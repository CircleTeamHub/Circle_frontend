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
