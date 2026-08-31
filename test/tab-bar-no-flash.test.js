const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('动态 tab 使用社交动态语义的光圈图标', () => {
  const layout = read('app/(tabs)/_layout.tsx');

  assert.match(
    layout,
    /name: 'discover',[\s\S]*?icon: 'aperture-outline',[\s\S]*?selectedIcon: 'aperture',[\s\S]*?key: 'tabs\.discover'/,
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

test('自绘 tab bar：避开系统导航栏，选中态只染色 icon，不渲染椭圆', () => {
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
  // 每个 tab 保持固定点击区域，回弹时不会挤压整条 tab bar。
  assert.match(layout, /const TAB_PILL_RADIUS/);
  assert.match(layout, /const TAB_PILL_RADIUS = TAB_PILL_HEIGHT \/ 2/);
  assert.match(layout, /height: TAB_PILL_HEIGHT/);
  assert.match(layout, /borderRadius: TAB_PILL_RADIUS/);
  // 选中态不能渲染任何胶囊或椭圆背景。
  assert.match(layout, /overflow: 'hidden'/);
  assert.doesNotMatch(layout, /activePillFill/);
  assert.doesNotMatch(layout, /focused && styles\.pillActive/);
  assert.doesNotMatch(layout, /pill:\s*\{[\s\S]*?flex:\s*1/);
});

test('iOS tab bar 使用真液态玻璃，并为旧系统提供原生模糊降级', () => {
  const layout = read('app/(tabs)/_layout.tsx');
  const pkg = JSON.parse(read('package.json'));

  // 只断言依赖在场：写死版本号会让每次例行 expo install --fix 都红在这里，
  // 而失败信息完全看不出「去改测试」。
  assert.ok(pkg.dependencies['expo-glass-effect']);
  assert.ok(pkg.dependencies['expo-blur']);
  assert.match(layout, /GlassView/);
  assert.match(layout, /isGlassEffectAPIAvailable\(\)/);
  assert.match(layout, /isLiquidGlassAvailable\(\)/);
  assert.match(layout, /glassEffectStyle=\{\{/);
  assert.match(layout, /style: hidden \? 'none' : 'regular'/);
  assert.doesNotMatch(layout, /<GlassView[\s\S]*?isInteractive/);
  assert.doesNotMatch(layout, /tintColor=\{colors\.primaryLight\}/);
  assert.match(layout, /colorScheme=\{colorScheme\}/);
  assert.match(layout, /intensity=\{\d+\}/);
  assert.match(layout, /tint="systemMaterial"/);
  assert.match(layout, /Platform\.OS === 'ios' \? 'transparent' : colors\.surface/);
  assert.match(
    layout,
    /const iconTint = focused \? colors\.tabBarActive : colors\.textSecondary/,
  );
  assert.match(
    layout,
    /const labelTint = focused \? colors\.tabBarActive : colors\.textSecondary/,
  );
  assert.match(layout, /name=\{focused \? tab\.selectedIcon : tab\.icon\}/);
  assert.match(layout, /focused && styles\.labelActive/);
  assert.match(layout, /labelActive: \{\s*fontWeight: '700'/);
  assert.doesNotMatch(layout, /activePillFill/);
  assert.match(layout, /onPressIn=\{\(\) => \{/);
  assert.doesNotMatch(layout, /Haptics/);
  assert.match(layout, /pressScale\.value = withSpring\(0\.92/);
  assert.match(layout, /pressScale\.value = withSpring\(1/);

  // GlassView 的父级 opacity 不能参与淡出，否则 iOS 26 会丢失折射层。
  assert.match(
    layout,
    /opacity: Platform\.OS === 'ios' \? 1 : 1 - hiddenProgress\.value/,
  );
});

test('选中态在暗色下必须读得清，红点描边不能浮在玻璃上', () => {
  const layout = read('app/(tabs)/_layout.tsx');
  const colorsSrc = read('src/theme/colors.ts');

  // brandPurple #7C5CF0 在暗色底 #1A1B23 上只有 3.79:1，9px 文字需要 4.5:1，
  // 而未选中的 textSecondary 是纯白 17:1 —— 选中项反而比未选中更糊。
  // 暗色单独给一支提亮的品牌紫，两个暗色底都在 5.6:1 以上。
  assert.match(colorsSrc, /tabBarActive: '#B18AFF'/);
  assert.match(colorsSrc, /tabBarActive: '#7C5CF0'/);
  assert.doesNotMatch(layout, /colors\.brandPurple/);

  // 红点的 2px 描边原本融进 colors.surface 的 bar 底色；iOS 底色改成
  // transparent 之后，那圈不透明环会浮在玻璃上。
  assert.match(
    layout,
    /borderWidth: Platform\.OS === 'ios' \? 0 : 2/,
  );

  // iOS 26 以下走 BlurView 降级：UIVisualEffectView 的圆角只有在
  // clipsToBounds 打开时才生效，而 styles.tabBar 刻意不裁剪（要留完整投影）。
  // 模糊层必须自己铺一张带 overflow 的绝对定位背景，否则整条 bar 会渲染成
  // 硬边矩形——模拟器上实测材质从外接矩形边缘 x=96 就开始，而不是胶囊圆弧的 x=134。
  assert.match(
    layout,
    /tabBarBlurLayer: \{\s*\.\.\.StyleSheet\.absoluteFillObject,\s*borderRadius: TAB_BAR_RADIUS,\s*overflow: 'hidden',/,
  );
  // [^>]* 限定在 BlurView 标签内匹配：跨标签的 [\s\S]*? 会一路吃到后面
  // Android/web 分支的 <View style={styles.tabBar}>，把断言变成永远成立。
  assert.match(layout, /<BlurView[^>]*style=\{styles\.tabBarBlurLayer\}/);
  assert.doesNotMatch(layout, /<BlurView[^>]*style=\{styles\.tabBar\}/);
});
