const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

// 回归：从无 tab bar 的深层页返回 tab 根页时，bar 会“闪一下才展示”。
// 根因是浮动 bar 用 display:none↔flex 瞬间切换，返回时在 JS 状态提交那刻
// 立即翻成 flex，浮动 bar 满不透明度直接出现在仍在退场的详情页之上。
// 修复：用 Reanimated 包一层，靠 translateY+opacity 平滑滑入/滑出，
// 不再瞬间切 display。
test('tab bar 通过 Reanimated 动画滑入/滑出，而非瞬间 display 切换（消除返回闪烁）', () => {
  const layout = read('app/(tabs)/_layout.tsx');

  // 不再用瞬间隐藏的 display:'none'，这是闪烁根因
  assert.doesNotMatch(
    layout,
    /display: ?'none'/,
    '不应再用 display:none 瞬间切换 tab bar',
  );

  // 改用 Reanimated 动画
  assert.match(layout, /react-native-reanimated/);
  assert.match(layout, /useAnimatedStyle/);
  assert.match(layout, /withTiming/);
  assert.match(layout, /translateY/);
  assert.match(layout, /opacity/);

  // 用自定义 tabBar 包裹真正的 BottomTabBar（保留原生 tab 行为/徽标/高亮）
  assert.match(layout, /BottomTabBar/);
  assert.match(layout, /tabBar=\{/);

  // 隐藏时禁用触摸，避免 off-screen 的 bar 仍捕获点击
  assert.match(layout, /pointerEvents/);
});

test('active tab pill uses the same outer geometry as the floating tab bar', () => {
  const layout = read('app/(tabs)/_layout.tsx');

  assert.match(layout, /const TAB_BAR_HEIGHT = 56/);
  assert.match(layout, /const TAB_BAR_RADIUS = TAB_BAR_HEIGHT \/ 2/);
  assert.match(layout, /const TAB_ACTIVE_PILL_HEIGHT = TAB_BAR_HEIGHT/);
  assert.match(layout, /const TAB_ACTIVE_PILL_RADIUS = TAB_BAR_RADIUS/);
  assert.match(layout, /const TAB_PILL_GAP = 0/);
  assert.match(layout, /overflow: 'hidden' as const/);
  assert.match(layout, /height: TAB_ACTIVE_PILL_HEIGHT/);
  assert.match(layout, /borderRadius: TAB_ACTIVE_PILL_RADIUS/);
});
