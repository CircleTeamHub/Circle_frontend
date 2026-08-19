const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('动态 tab 使用社交动态语义的光圈图标', () => {
  const layout = read('app/(tabs)/_layout.tsx');

  assert.match(
    layout,
    /name: 'discover', icon: 'aperture-outline', key: 'tabs\.discover'/,
  );
  assert.doesNotMatch(layout, /play-circle-outline/);
});

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

test('自绘 tab bar：避开系统导航栏，选中态保持胶囊形状而不是方块色带', () => {
  const layout = read('app/(tabs)/_layout.tsx');

  // bar 是完整胶囊
  assert.match(layout, /const TAB_BAR_HEIGHT = \d+/);
  assert.match(layout, /const TAB_BAR_RADIUS = TAB_BAR_HEIGHT \/ 2/);
  // 浮动条贴近底部安全区，不要悬得过高遮住列表主体。
  assert.match(layout, /const TAB_BAR_MARGIN_B = 2/);
  assert.match(layout, /const TAB_BAR_SAFE_AREA_OVERLAP = 14/);
  // Android 三键/手势导航栏会占用底部 safe area，浮动 bar 必须叠加 bottom inset。
  assert.match(layout, /useSafeAreaInsets/);
  assert.match(layout, /const insets = useSafeAreaInsets\(\)/);
  assert.match(layout, /Math\.max\(insets\.bottom - TAB_BAR_SAFE_AREA_OVERLAP, 0\)/);
  // 上下内边距 → 药丸高 = bar 高 - 2*PAD_V，不靠 flex 拉满救场
  assert.match(layout, /const TAB_BAR_PAD_V/);
  assert.match(layout, /const TAB_PILL_HEIGHT = TAB_BAR_HEIGHT - TAB_BAR_PAD_V \* 2/);
  assert.match(layout, /paddingVertical: TAB_BAR_PAD_V/);
  // 选中药丸：固定高度 + 半圆 radius，避免 Android 上出现矩形紫色块。
  assert.match(layout, /const TAB_PILL_RADIUS/);
  assert.match(layout, /const TAB_PILL_RADIUS = TAB_PILL_HEIGHT \/ 2/);
  assert.match(layout, /height: TAB_PILL_HEIGHT/);
  assert.match(layout, /borderRadius: TAB_PILL_RADIUS/);
  // 切换 tab 后，紫色 active 层必须被稳定的 pill 外壳裁剪，不能靠同一个 View 改背景色。
  assert.match(layout, /overflow: 'hidden'/);
  assert.match(layout, /activePillFill: \{/);
  assert.match(layout, /\.\.\.StyleSheet\.absoluteFillObject/);
  assert.match(layout, /focused \? <View style=\{styles\.activePillFill\} \/> : null/);
  assert.doesNotMatch(layout, /focused && styles\.pillActive/);
  assert.doesNotMatch(layout, /pill:\s*\{[\s\S]*?flex:\s*1/);
});
