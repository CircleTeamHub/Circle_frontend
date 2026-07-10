const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('tabs pop their stack to home on blur (no stuck cross-tab screens)', () => {
  const layout = read('app/(tabs)/_layout.tsx');
  // 离开 tab 即弹回首页：否则跨 tab 压栈的页面留在栈顶,
  // 点 tab 永远进那个页面而不是首页。
  assert.match(layout, /popToTopOnBlur: true/);
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
