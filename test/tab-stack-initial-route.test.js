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
