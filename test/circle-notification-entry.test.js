const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

// 圈子通知设置一度从 App 里彻底消失：CircleManagementScreen 是唯一 push 到它的
// 地方，而 #195 把发现页那行「圈子管理」删掉之后，再没有任何地方 push 到
// CircleManagementScreen —— 设置页还在，只是谁也走不到。这个文件钉住入口存在。

test('circle notification settings are reachable from the circles screen', () => {
  const screen = read('src/features/discover/screens/MyCirclesScreen.tsx');

  assert.match(screen, /rightIcon="settings-outline"/);
  assert.match(screen, /onRightPress=\{handleOpenNotificationSettings\}/);
  assert.match(screen, /getCircleNotificationSettingsHref/);
});

// 屏幕住在 discover 域下，入口却在联系人栈。写死 discover 路由会把用户甩去另一个
// tab，返回时也回不到他出发的那一栈 —— 仓库对这类跨栈屏幕的既定做法是按
// segments 解析当前栈（参见 getGroupLogHref 等）。
test('the entry resolves the current stack instead of hardcoding discover', () => {
  const screen = read('src/features/discover/screens/MyCirclesScreen.tsx');
  assert.match(screen, /getUserProfileScopeFromSegments\(segments\)/);
  assert.doesNotMatch(screen, /'\/\(tabs\)\/discover\/notifications'/);

  const settings = read(
    'src/features/discover/screens/CircleNotificationSettingsScreen.tsx',
  );
  // 设置页里的「圈子玩法说明」同理：它是从设置页点进去的，得留在同一栈。
  assert.match(settings, /getCircleGuideHref/);
  assert.doesNotMatch(settings, /router\.push\('\/\(tabs\)\/discover\/guide'\)/);
});

test('the contacts stack mounts both screens it can now reach', () => {
  assert.match(
    read('app/(tabs)/contacts/circle-notifications.tsx'),
    /CircleNotificationSettingsScreen/,
  );
  assert.match(
    read('app/(tabs)/contacts/circle-guide.tsx'),
    /CircleGuideScreen/,
  );
});

test('both hrefs keep a discover variant for the discover stack', () => {
  const routes = read('src/features/user/utils/routes.ts');

  for (const helper of [
    'getCircleNotificationSettingsHref',
    'getCircleGuideHref',
  ]) {
    const start = routes.indexOf(`export function ${helper}`);
    assert.notEqual(start, -1, `${helper} is missing`);
    const body = routes.slice(start, start + 600);
    assert.match(body, /case 'contacts':/, `${helper} has no contacts branch`);
    assert.match(body, /\/\(tabs\)\/contacts\//, `${helper} has no contacts route`);
    assert.match(body, /\/\(tabs\)\/discover\//, `${helper} has no discover route`);
  }
});
