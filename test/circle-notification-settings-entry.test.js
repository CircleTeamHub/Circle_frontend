const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('圈子动态头部不再重复显示圈子通知设置入口', () => {
  const src = read('src/features/discover/screens/CirclePlazaScreen.tsx');

  // 圈子通知设置由圈子管理页统一提供，动态页只保留筛选和通知中心入口。
  assert.doesNotMatch(src, /name="settings-outline"/);
  assert.doesNotMatch(src, /CircleNotificationSettingsSheet/);
});

test('动态页入口删掉后，那个快捷弹层也不留成孤儿组件', () => {
  // 弹层唯一的调用方就是动态页头部的齿轮。只删入口不删组件，
  // 仓库里会剩一个不上线、却仍有测试替它把关的组件。
  const sheetPath = path.join(
    process.cwd(),
    'src/features/discover/components/circle-notification-settings-sheet.tsx',
  );
  assert.equal(fs.existsSync(sheetPath), false);
});

test('整页设置复用共享的三档开关组件', () => {
  const toggles = read(
    'src/features/discover/components/circle-notification-toggles.tsx',
  );
  const screen = read(
    'src/features/discover/screens/CircleNotificationSettingsScreen.tsx',
  );

  assert.match(toggles, /export function CircleNotificationToggles/);
  // 组件只负责承载：状态、服务端同步、回滚全在 hook 里，个人设置页用的是同一个。
  assert.match(toggles, /useCircleNotificationTiers/);
  assert.doesNotMatch(toggles, /useCircleNotificationStore/);
  // 三档：全局 / 声音 / 离线。总闸关掉时另外两档同步置灰，这条语义只能有一处实现。
  assert.equal(toggles.match(/<NotificationItem/g).length, 3);
  assert.equal(toggles.match(/disabled=\{!tiers\.globalEnabled\}/g).length, 2);

  assert.match(screen, /CircleNotificationToggles/);
  assert.doesNotMatch(screen, /const NotificationItem/);
});

test('「声音提醒」是真开关，不是当年那个不接线的死设置', () => {
  const snackbar = read(
    'src/features/notifications/components/NotificationSnackbarHost.tsx',
  );
  const feedback = read(
    'src/features/notifications/hooks/use-notification-feedback.ts',
  );

  // 历史上 soundEnabled 从没接过线。这次必须落到真正播放提示音的那一处，
  // 而且只静音、不吞掉震动。
  assert.match(snackbar, /circleSoundAllowed\(useCircleNotificationStore\.getState\(\)\)/);
  assert.match(snackbar, /CIRCLE_/);
  assert.match(feedback, /options\?\.silent/);
  assert.match(feedback, /soundEnabled && !options\?\.silent/);
  // 震动在静音之外，产品语义是「静音」不是「无提醒」。
  assert.match(feedback, /if \(hapticsEnabled\) \{/);
});

test('「离线提醒」由服务端执行，不是只存在本地的假开关', () => {
  const hook = read(
    'src/features/discover/hooks/use-circle-notification-tiers.ts',
  );
  const api = read('src/services/api/notifications.ts');

  assert.match(api, /circle-push-preference/);
  assert.match(api, /export async function updateCircleOfflinePushEnabled/);
  // 写失败要回滚本地开关并提示：留一个说关了其实没关的开关比报错更糟。
  // 回滚/排序/留痕的行为断言在
  // src/features/discover/hooks/use-circle-notification-tiers.spec.tsx。
  assert.match(hook, /updateCircleOfflinePushEnabled/);
  assert.match(hook, /discover\.notifications\.syncFailed/);
  // 读写失败都要留痕 —— 曾经是 .catch(() => {})，「关了还在推」查不到断在哪。
  assert.match(hook, /reportHandledFailure\('circleNotification', 'offlinePushFetch'/);
  assert.match(hook, /reportHandledFailure\('circleNotification', 'offlinePushSync'/);
});
