const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('五个 tab 依次是 消息/联系人/圈子/探索/我的，圈子用 App 纸飞机标', () => {
  const bar = read('src/components/app/floating-tab-bar.tsx');
  const names = [...bar.slice(bar.indexOf('export const TAB_KEYS'), bar.indexOf('const TAB_BY_NAME'))
    .matchAll(/name: '(\w+)'/g)].map((match) => match[1]);
  assert.deepEqual(names, ['messages', 'contacts', 'discover', 'explore', 'profile']);

  // 圈子 tab 的路由目录沿用 discover（深链都挂在下面），文案是「圈子」。
  assert.match(bar, /name: 'discover',\s*icon: 'plane-logo',\s*key: 'tabs\.circles'/);
  assert.match(
    bar,
    /name: 'explore',\s*icon: 'compass-outline',\s*selectedIcon: 'compass',\s*key: 'tabs\.explore'/,
  );
  // 纸飞机随选中态着色，和 Ionicons 一样走 iconTint。
  assert.match(bar, /<PlaneLogoIcon[\s\S]*?color=\{iconTint\}[\s\S]*?filled=\{focused\}/);
  assert.match(bar, /explore: E2E_TEST_IDS\.tabsExplore/);
});

// 回归：深层页面隐藏 tab bar，返回 tab 根页时直接显示且不从底部滑入。
test('tab bar 隐藏时瞬时移出屏幕，返回根页直接显示', () => {
  const layout = (read('app/(tabs)/_layout.tsx') + read('src/components/app/floating-tab-bar.tsx'));

  // 不再用瞬间隐藏的 display:'none'，这是闪烁根因
  assert.doesNotMatch(
    layout,
    /display: ?'none'/,
    '不应再用 display:none 瞬间切换 tab bar',
  );

  // 所有页面保持同一个 tab bar 挂载；深层页瞬时挪出屏幕并禁用触摸，不卸载、不做动画。
  assert.match(layout, /useSegments/);
  assert.match(layout, /const hideTabBar = segments\.length > 2/);
  assert.match(layout, /hidden=\{hideTabBar\}/);
  assert.doesNotMatch(layout, /if \(hidden\) return null/);
  assert.doesNotMatch(layout, /hiddenProgress/);
  assert.doesNotMatch(layout, /TAB_BAR_ANIM_DURATION/);
  assert.doesNotMatch(layout, /TAB_BAR_EASING/);
  assert.doesNotMatch(layout, /translateY: hidden/);
  assert.match(layout, /pointerEvents=\{hidden \? 'none' : 'box-none'\}/);
  // 回归：隐藏不能动 opacity。GlassView / BlurView 祖先透明度归零会停掉材质层，
  // 回到根页要重新生成材质，tab bar 会晚一拍（约 1 秒）才出现。
  assert.match(
    layout,
    /tabBarHidden: \{\s*transform: \[\{ translateY: TAB_BAR_HIDDEN_OFFSET \}\]/,
  );
  assert.doesNotMatch(layout, /tabBarHidden: \{\s*opacity/);
  assert.match(layout, /animate: false/);

  // 用自定义 tabBar 包裹真正的 BottomTabBar（保留原生 tab 行为/徽标/高亮）
  assert.match(layout, /BottomTabBar/);
  assert.match(layout, /tabBar=\{/);

  // 隐藏时禁用触摸，避免透明的 bar 仍捕获点击
  assert.match(layout, /pointerEvents/);
});

test('自绘 tab bar：避开系统导航栏，选中态用弹性胶囊反馈当前 tab', () => {
  const layout = (read('app/(tabs)/_layout.tsx') + read('src/components/app/floating-tab-bar.tsx'));

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
  const layout = (read('app/(tabs)/_layout.tsx') + read('src/components/app/floating-tab-bar.tsx'));
  const pkg = JSON.parse(read('package.json'));

  // 只断言依赖在场：写死版本号会让每次例行 expo install --fix 都红在这里，
  // 而失败信息完全看不出「去改测试」。
  assert.ok(pkg.dependencies['expo-glass-effect']);
  assert.ok(pkg.dependencies['expo-blur']);
  assert.match(layout, /GlassView/);
  assert.match(layout, /isGlassEffectAPIAvailable\(\)/);
  assert.match(layout, /isLiquidGlassAvailable\(\)/);
  assert.match(layout, /glassEffectStyle=\{\{/);
  // Liquid Glass uses the clear native style directly. The BlurView fallback is
  // kept for older iOS versions, but must not be nested inside GlassView.
  assert.match(layout, /style: 'clear'/);
  assert.doesNotMatch(layout, /style: hidden \? 'none' : 'regular'/);
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

  // tab bar 持续挂载，玻璃材质本身也不播放显隐动画。
  assert.match(layout, /animate: false/);
});

test('选中态在暗色下必须读得清，红点描边不能浮在玻璃上', () => {
  const layout = (read('app/(tabs)/_layout.tsx') + read('src/components/app/floating-tab-bar.tsx'));
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

test('旧系统模糊 fallback 使用半透明底色，液态玻璃路径交给系统材质', () => {
  const layout = (read('app/(tabs)/_layout.tsx') + read('src/components/app/floating-tab-bar.tsx'));

  // iOS 上 tabBar 自身底色是 transparent。旧系统由 BlurView + 半透明 surface
  // 提供遮蔽；GlassView 的 contentView 会覆盖其原生效果，不能再把 BlurView
  // 或 tint 作为子节点嵌进去，否则液态玻璃会退化成实心板。
  assert.match(layout, /const TAB_BAR_TINT_ALPHA = 0\.\d+;/);
  assert.match(layout, /backgroundColor: withAlpha\(colors\.surface, TAB_BAR_TINT_ALPHA\)/);
  assert.match(layout, /borderRadius: TAB_BAR_RADIUS/);

  // 半透明 tint 只存在于旧系统 fallback。
  const tintLayers = layout.match(/style=\{styles\.tabBarTint\}/g) ?? [];
  assert.equal(tintLayers.length, 1);
  // 遮罩纯装饰，不能吃掉 tab 的点击。
  assert.match(layout, /style=\{styles\.tabBarTint\} pointerEvents="none"/);

  // Android / Web 本来就是不透明 surface，不该再叠一层。
  assert.match(layout, /Platform\.OS === 'ios' \? 'transparent' : colors\.surface/);
});

test('旧系统 iOS fallback 保留原生磨砂层', () => {
  const layout = (read('app/(tabs)/_layout.tsx') + read('src/components/app/floating-tab-bar.tsx'));

  // GlassView 的子节点会盖住原生玻璃效果，所以液态玻璃路径不能再嵌 BlurView；
  // 旧系统 fallback 仍然使用同一档 BlurView 磨砂材质。
  const frostLayers = layout.match(/<TabBarFrostLayer /g) ?? [];
  assert.equal(frostLayers.length, 1);
  assert.match(layout, /function TabBarFrostLayer\(/);

  // fallback 的叠放次序：磨砂在下，半透明遮罩在上，tab 项在最上。
  assert.match(
    layout,
    /<TabBarFrostLayer [\s\S]{0,120}?styles\.tabBarTint\}[\s\S]{0,120}?\{children\}/,
  );

  assert.match(layout, /const TAB_BAR_BLUR_INTENSITY = \d+;/);
  assert.match(layout, /intensity=\{TAB_BAR_BLUR_INTENSITY\}/);
});

// 回归：原生端返回 tab 首页时 bar 晚约半秒才出现。全局浮层靠导航状态切显隐，
// 而手势返回的状态要等原生转场结束才回调（真机实测 transitionEnd 后才收到）。
// 正解是跟系统 App 一样：bar 属于首页内容，推入的页面盖住它，返回时随首页滑回。
test('原生端 tab bar 由各 tab 首页渲染，不再靠导航状态切显隐', () => {
  const layout = read('app/(tabs)/_layout.tsx');
  const root = read('src/components/app/tab-root-screen.tsx');

  // 原生端 Tabs 只发布导航器 props，不渲染全局浮层；Web 仍走全局浮层。
  assert.match(
    layout,
    /Platform\.OS === 'web' \? \(\s*<FloatingTabBar tabProps=\{props\} hidden=\{hideTabBar\} \/>\s*\) : \(\s*<TabBarBridge \{\.\.\.props\} \/>/,
  );
  assert.match(layout, /useLayoutEffect\(\(\) => \{\s*publish\(owner, props\);/);
  // 卸载只撤下自己那份,不能无条件置空(旧桥清理晚于新桥发布)。
  assert.match(layout, /unpublish\(owner\)/);
  assert.doesNotMatch(layout, /publish\(null\)/);

  // 首页外壳在原生端把 bar 作为本页内容渲染，且永远不隐藏。
  assert.match(root, /if \(Platform\.OS === 'web'\) return <>\{children\}<\/>/);
  assert.match(root, /<FloatingTabBar tabProps=\{tabProps\} hidden=\{false\} \/>/);

  // 每个 tab 首页都必须套上外壳，少一个那个 tab 就没有 bar。
  for (const tab of ['messages', 'contacts', 'discover', 'explore', 'profile']) {
    assert.match(
      read(`app/(tabs)/${tab}/index.tsx`),
      /<TabRootScreen>[\s\S]*<\/TabRootScreen>/,
      `${tab} 首页没有套 TabRootScreen`,
    );
  }
});

test('hidden tab bar leaves the accessibility tree and keyboard focus', () => {
  const layout = (read('app/(tabs)/_layout.tsx') + read('src/components/app/floating-tab-bar.tsx'));
  // 透明 + pointerEvents none 只挡住了触摸；读屏和网页键盘还能聚焦到看不见的按钮。
  assert.match(layout, /accessibilityElementsHidden=\{hidden\}/);
  assert.match(layout, /importantForAccessibility=\{hidden \? 'no-hide-descendants' : 'auto'\}/);
  assert.match(layout, /aria-hidden=\{hidden\}/);
  assert.match(layout, /disabled=\{hidden\}\s*\n\s*focusable=\{!hidden\}/);
  assert.match(layout, /hidden=\{hidden\}\s*\n\s*testID=\{TAB_TEST_IDS\[route\.name\]\}/);
});

test('旧 tab bar 桥卸载时不会撤掉新桥刚发布的 bar（登录后 bar 迟迟不出现）', () => {
  const store = read('src/stores/tabBarBridgeStore.ts');
  assert.match(store, /unpublish: \(owner\) => \{\s*if \(get\(\)\.owner !== owner\) return;/);
});
