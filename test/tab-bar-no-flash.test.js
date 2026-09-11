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

test('自绘 tab bar：避开系统导航栏，选中态用弹性胶囊反馈当前 tab', () => {
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
  // 选中态胶囊只覆盖单格内容，并由 Reanimated 弹性出现/消失。
  assert.match(layout, /overflow: 'hidden'/);
  assert.match(layout, /liquidIndicator: \{/);
  assert.match(layout, /const indicatorX = useSharedValue/);
  assert.match(layout, /const indicatorStretch = useSharedValue\(1\)/);
  assert.match(layout, /const indicatorSquash = useSharedValue\(1\)/);
  assert.match(layout, /indicatorX\.value = withTiming\(targetX/);
  assert.match(layout, /indicatorStretch\.value = withSequence/);
  assert.match(layout, /withTiming\(1\.32/);
  assert.match(layout, /withTiming\(0\.84/);
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
  assert.match(layout, /intensity=\{TAB_BAR_BLUR_INTENSITY\}/);
  // 应用允许主题与系统外观不同；旧版 iOS 的自适应 systemMaterial 只跟随
  // 系统，可能把暗色主题的白字放到浅色材质上。降级材质必须跟随 resolvedMode。
  // Thick 是给 sheet/弹窗用的最厚材质，本身接近不透明 —— 叠上 intensity 100
  // 和纯色遮罩就成了实心板，玻璃感全丢。Thin 保留磨砂扩散又还透光。
  assert.match(
    layout,
    /tint=\{colorScheme === 'dark' \? 'systemThinMaterialDark' : 'systemThinMaterialLight'\}/,
  );
  assert.doesNotMatch(layout, /tint="systemMaterial"/);
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
  // 暗色单独给一支提亮的品牌紫（DARK_ACCENT），两个暗色底都在 5.6:1 以上；
  // 色值本身在 test/theme-accent-tokens.test.js 里按实际导出值断言。
  assert.match(colorsSrc, /const DARK_ACCENT = '#B18AFF'/);
  assert.match(colorsSrc, /tabBarActive: DARK_ACCENT/);
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

test('玻璃 tab bar 上要垫一层半透明底色，不能让下方内容直接透穿', () => {
  const layout = read('app/(tabs)/_layout.tsx');

  // iOS 上 tabBar 自身底色是 transparent —— GlassView / BlurView 必须采样下方
  // 内容才有材质。代价是身下一有真实内容（动态 tab 现在直接就是圈子广场的
  // 卡片流，而不再是一屏空白菜单），整条 bar 就被看穿。
  // 解法是在玻璃/模糊之上、tab 项之下垫一层 surface 调透明度的遮罩。
  assert.match(layout, /const TAB_BAR_TINT_ALPHA = 0\.\d+;/);
  assert.match(layout, /backgroundColor: withAlpha\(colors\.surface, TAB_BAR_TINT_ALPHA\)/);
  assert.match(layout, /borderRadius: TAB_BAR_RADIUS/);

  // 两条 iOS 路径（液态玻璃 / 旧系统模糊降级）都必须垫，少一条就只修一半。
  const tintLayers = layout.match(/style=\{styles\.tabBarTint\}/g) ?? [];
  assert.equal(tintLayers.length, 2);
  // 遮罩纯装饰，不能吃掉 tab 的点击。
  assert.match(layout, /style=\{styles\.tabBarTint\} pointerEvents="none"/);

  // Android / Web 本来就是不透明 surface，不该再叠一层。
  assert.match(layout, /Platform\.OS === 'ios' \? 'transparent' : colors\.surface/);
});

test('磨砂层在两条 iOS 路径上都要有——液态玻璃本身不提供磨砂强度', () => {
  const layout = read('app/(tabs)/_layout.tsx');

  // expo-glass-effect 的 GlassView 只有 clear/regular/none，没有磨砂强度旋钮，
  // 液态玻璃偏"清透折射"而不是"磨砂扩散"。所以 iOS 26 这条路径要在玻璃之上
  // 再叠一层 BlurView 才有磨砂；否则只有旧系统的降级路径是磨砂的，两代观感分裂。
  const frostLayers = layout.match(/<TabBarFrostLayer /g) ?? [];
  assert.equal(frostLayers.length, 2);
  // 抽成共用组件，两代用的是同一档材质与强度，不会各调各的。
  assert.match(layout, /function TabBarFrostLayer\(/);

  // 叠放次序：玻璃/磨砂在下，纯色遮罩在上，tab 项在最上。
  assert.match(
    layout,
    /<TabBarFrostLayer [\s\S]{0,120}?styles\.tabBarTint\}[\s\S]{0,120}?\{children\}/,
  );

  // 磨砂拉满，让扩散本身承担遮蔽；纯色遮罩退回去，否则质感被压成一块平板。
  assert.match(layout, /const TAB_BAR_BLUR_INTENSITY = \d+;/);
  assert.match(layout, /intensity=\{TAB_BAR_BLUR_INTENSITY\}/);
});
