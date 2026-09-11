const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

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

test('notification center keeps the bell badges in sync when interactive items are read', () => {
  const source = readScreen();

  // 读一条通知要同时扣总数和它所属域的计数，否则对应铃铛的红点清不掉。
  assert.match(source, /Math\.max\(0, badgeStore\.discoverUnread - 1\)/);
  assert.match(source, /Math\.max\(0, badgeStore\.momentsUnread - 1\)/);
  assert.match(source, /Math\.max\(0, badgeStore\.circleUnread - 1\)/);
  assert.match(source, /if \(!raw\.read\) decrementUnreadBadges\(raw\.type\)/);
  // 失败要能整组回滚。
  assert.match(source, /rollback\.setDiscoverUnread\(previousBadges\.discoverUnread\)/);
  assert.match(source, /rollback\.setMomentsUnread\(previousBadges\.momentsUnread\)/);
  assert.match(source, /rollback\.setCircleUnread\(previousBadges\.circleUnread\)/);
  // systemUnread 已整体删除（#103）——这里不允许再出现对它的读写。
  assert.doesNotMatch(source, /systemUnread/i);
});

test('circle bell lists signup management first; the other entries keep notifications first', () => {
  const { orderNotificationTabs } = loadTsModule(
    'src/features/notifications/utils/notification-tabs.ts',
  );
  const tabs = { notifications: 'notifications', signups: 'signups' };

  // 圈子铃铛：报名管理在左、圈子动态在右。
  // loadTsModule 在 vm 里跑，返回的数组原型不是本 realm 的 Array —— 展开后再比（否则 deepEqual 会在
  // 内容完全相同的情况下报原型不符）。
  assert.deepEqual([...orderNotificationTabs('circle', tabs)], ['signups', 'notifications']);
  // 推送兜底页（不限域）保持老顺序。
  assert.deepEqual([...orderNotificationTabs(null, tabs)], ['notifications', 'signups']);
  // 朋友圈铃铛（有域但不是圈子）同样保持老顺序。
  assert.deepEqual([...orderNotificationTabs('moments', tabs)], ['notifications', 'signups']);
  // 输入不被改动。
  assert.deepEqual(tabs, { notifications: 'notifications', signups: 'signups' });

  // 页面必须走这条规则，而不是自己再排一遍；「朋友圈铃铛没有报名 tab」的判断留在页面里。
  const source = readScreen();
  assert.match(
    source,
    /orderNotificationTabs\(domain, \{ notifications: primary, signups \}\)/,
  );
  assert.match(source, /if \(!showSignupTab\) return \[primary\];/);
  assert.doesNotMatch(source, /\[signups, primary\]/);
  // 默认选中项有意保持「圈子动态」：#238 只调顺序，不改落地页。
  assert.match(source, /useState<NotificationTabKey>\('notifications'\)/);
});
