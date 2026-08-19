const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('tabs keep per-tab stack state (popToTopOnBlur must stay off)', () => {
  const layout = read('app/(tabs)/_layout.tsx');
  // 曾用 popToTopOnBlur 兜底跨 tab 压栈,但它会连正常的 tab 内浏览状态一起
  // 清掉。正确解法是圈子路由按 scope 镜像(聊天名片在本 tab 内打开),
  // tab 状态保留。
  assert.doesNotMatch(layout, /popToTopOnBlur/);
});

test('every tab stack anchors index as initialRouteName (cross-tab push safety)', () => {
  // 跨 tab 压栈（聊天点圈子名片→discover/circle、横幅→messages/chat-detail 等）
  // 若目标栈底没有首页，返回无处可去，tab 永远卡在被压入的页面。
  for (const tab of ['discover', 'messages', 'contacts', 'profile']) {
    const layout = read(`app/(tabs)/${tab}/_layout.tsx`);
    assert.match(
      layout,
      /export const unstable_settings = \{\s*initialRouteName: 'index',\s*\}/,
      `${tab} layout missing initialRouteName anchor`,
    );
  }
});

test('messages "新建群聊" stays in the messages stack', () => {
  // 独立群聊回归:建群=好友多选建独立群(new-group),不再借道创建圈子页。
  // 无论目标是什么,都必须走本 tab 的路由 —— 压进 discover 栈会让「动态」tab
  // 卡在被压入的页面上。
  const screen = read('src/features/messages/screens/MessagesScreen.tsx');
  assert.match(screen, /router\.push\("\/\(tabs\)\/messages\/new-group"\)/);
  assert.doesNotMatch(screen, /\/\(tabs\)\/discover\/create-circle/);
  assert.doesNotMatch(screen, /\/\(tabs\)\/discover\/new-group/);
});

test('screens mirrored into both stacks route their sub-pages by scope', () => {
  // create-circle / circle/[id]/edit 两个栈都有镜像，共用 circle-form-body。
  // 表单里的「关联城市」若写死 discover，从聊天那侧进去就会跨 tab 跳走。
  for (const rel of [
    'app/(tabs)/messages/create-circle.tsx',
    'app/(tabs)/messages/select-city.tsx',
    'app/(tabs)/discover/create-circle.tsx',
    'app/(tabs)/discover/select-city.tsx',
  ]) {
    assert.ok(
      fs.existsSync(path.join(__dirname, '..', rel)),
      `${rel} missing — 镜像不成对，跨栈跳转必然穿帮`,
    );
  }

  const form = read('src/features/discover/components/circle-form-body.tsx');
  assert.match(form, /useSegments/);
  assert.match(form, /inDiscoverStack[\s\S]{0,120}\/\(tabs\)\/messages\/select-city/);
});
