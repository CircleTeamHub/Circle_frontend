const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (/\.(tsx?|mts)$/.test(entry.name)) out.push(abs);
  }
  return out;
}

// 三端统一弹窗：Alert.alert / Alert.prompt 在启动时整个改投到自绘 AppDialogHost。
// 之前只有 web 接管（RNW 的 Alert 是空函数），原生仍是系统弹窗、两端长得不一样，
// 而且 Alert.prompt 在 Android 上是 RN 源码级的静默空操作。

test('root layout mounts the dialog host and the top notice host on every platform', () => {
  const layout = read('app/_layout.tsx');
  assert.match(layout, /<AppDialogHost \/>/);
  assert.match(layout, /<TopNoticeHost \/>/);
  // 不能再像旧的 WebAlertHost 那样只在 web 挂。
  assert.doesNotMatch(layout, /Platform\.OS === 'web' \? <AppDialogHost/);
  assert.doesNotMatch(layout, /WebAlertHost/);
  // 语言水合之后才装桥，默认按钮文案才跟当前语言。
  assert.match(layout, /rehydrateLanguageFromStorage\(\);[\s\S]*installAlertBridge\(\);/);
});

test('alert bridge takes over both Alert.alert and Alert.prompt without a platform branch', () => {
  const bridge = read('src/utils/alert-bridge.ts');
  assert.match(bridge, /Alert\.alert = \(/);
  assert.match(bridge, /Alert\.prompt = \(/);
  assert.doesNotMatch(bridge, /Platform\.OS/);
  assert.match(bridge, /showDialog\(/);
  // 默认按钮取本地化的「知道了」，不再是 RN 硬编码的英文 OK。
  assert.match(bridge, /common\.ok/);
});

test('the old web-only alert host is gone and nothing still imports it', () => {
  assert.equal(fs.existsSync('src/components/app/web-alert-host.tsx'), false);
  assert.equal(fs.existsSync('src/utils/localized-alert.ts'), false);
  const offenders = [...walk('src'), ...walk('app')].filter((file) =>
    /web-alert-host|localized-alert|installLocalizedAlertDefaults/.test(
      fs.readFileSync(file, 'utf8'),
    ),
  );
  assert.deepEqual(offenders, []);
});

test('iOS dialogs ride FullWindowOverlay so they stack above open native modals', () => {
  const overlay = read('src/components/app/dialog-overlay.tsx');
  assert.match(overlay, /FullWindowOverlay/);
  assert.match(overlay, /Platform\.OS === 'ios'/);
  // 只在有弹窗时才挂载：容器是挂载那一刻 addSubview 到窗口的，晚挂才压得住已有面板。
  assert.match(overlay, /if \(!visible\) return null;/);
  // Android / Web：透明 Modal，盖住状态栏 + 导航栏，硬件返回 / Esc 走 onRequestClose。
  assert.match(overlay, /statusBarTranslucent/);
  assert.match(overlay, /navigationBarTranslucent/);
  assert.match(overlay, /onRequestClose=\{onRequestClose\}/);
});

test('dialog host runs the button callback synchronously before closing (web user-gesture APIs)', () => {
  const host = read('src/components/app/app-dialog-host.tsx');
  assert.match(
    host,
    /try \{\s*if \(shown\.prompt\) \{\s*slot\.button\.onPress\?\.\(promptValue\);\s*\} else \{\s*slot\.button\.onPress\?\.\(\);\s*\}\s*\} finally \{\s*close\(\);/,
  );
});

test('dialog host wires the store queue, dismissal policy and the reduce-motion preference', () => {
  const host = read('src/components/app/app-dialog-host.tsx');
  assert.match(host, /useAppDialogStore\(\(state\) => state\.queue\[0\]/);
  assert.match(host, /resolveDialogDismissal\(shown\)/);
  assert.match(host, /useReduceMotion\(\)/);
  assert.match(host, /KeyboardAvoidingView/);
});

test('dialog buttons use the contrast-checked danger tokens, never raw error red on a fill', () => {
  const button = read('src/components/app/app-dialog-button.tsx');
  assert.match(button, /colors\.dangerFill/);
  assert.match(button, /colors\.danger\b/);
  assert.doesNotMatch(button, /colors\.error/);

  for (const palette of ['darkColors', 'lightColors']) {
    const colors = read('src/theme/colors.ts');
    const block = colors.slice(colors.indexOf(`export const ${palette}`));
    for (const token of ['danger:', 'dangerFill:', 'surfaceMuted:']) {
      assert.match(block, new RegExp(`\\b${token}`), `${palette} lacks ${token}`);
    }
  }
});

test('both top banners share one glass card so they read as the same family', () => {
  const notice = read('src/components/app/top-notice-host.tsx');
  const snackbar = read('src/features/notifications/components/NotificationSnackbarHost.tsx');
  for (const host of [notice, snackbar]) {
    assert.match(host, /topBannerSurface\.host/);
    assert.match(host, /topBannerSurface\.frame/);
    assert.match(host, /<TopBannerCard>/);
    // 玻璃材质的祖先不能有 opacity 动画（材质会失效）：横幅只做位移进出。
    assert.match(host, /topBannerHiddenOffset\(insets\.top\)/);
    assert.doesNotMatch(host, /opacity: anim/);
  }
  // 提醒可上滑关掉、到时自动收起、读屏当 alert 播报。
  assert.match(notice, /useSwipeUpDismiss/);
  assert.match(notice, /setTimeout\(\(\) => hide\(shown\.id\), shown\.durationMs\)/);
  assert.match(notice, /accessibilityRole="alert"/);
});

test('the glass surface degrades by platform and never sits under an animated opacity', () => {
  const glass = read('src/components/ui/glass-surface.tsx');
  // iOS 26 液态玻璃 → 旧 iOS 磨砂 → 其他平台半透明实底，三条路径都在。
  assert.match(glass, /isGlassEffectAPIAvailable\(\) && isLiquidGlassAvailable\(\)/);
  assert.match(glass, /<GlassView/);
  assert.match(glass, /<BlurView/);
  assert.match(glass, /FALLBACK_SURFACE_ALPHA/);
  assert.match(glass, /colors\.glassBorder/);

  const card = read('src/components/app/app-dialog-card.tsx');
  assert.match(card, /<GlassSurface material="dialog"/);
  // 内容淡入放在玻璃里面；外层卡片帧只缩放。
  assert.match(card, /<Animated\.View style=\{\{ opacity: contentOpacity \}\}>/);
  const host = read('src/components/app/app-dialog-host.tsx');
  assert.match(host, /style=\{\[s\.cardFrame, \{ transform: \[\{ scale \}\] \}\]\}/);
  assert.doesNotMatch(host, /s\.cardFrame, \{ opacity/);

  const banner = read('src/components/ui/top-banner-card.tsx');
  assert.match(banner, /<GlassSurface material="banner"/);

  // Android：dimezis 实时模糊，靶子是根布局里包住整棵 App 内容的 BlurTargetView。
  assert.match(glass, /blurMethod="dimezisBlurViewSdk31Plus"/);
  assert.match(glass, /blurTarget=\{androidTarget\}/);
  const target = read('src/components/app/app-blur-target.tsx');
  assert.match(target, /<BlurTargetView ref=\{targetRef\}/);
  const layout = read('app/_layout.tsx');
  assert.match(layout, /<AppBlurTarget>[\s\S]*<RootStack \/>[\s\S]*<\/AppBlurTarget>/);

  for (const palette of ['darkColors', 'lightColors']) {
    const colors = read('src/theme/colors.ts');
    const block = colors.slice(colors.indexOf(`export const ${palette}`));
    for (const token of ['glassBorder:', 'glassButton:']) {
      assert.match(block, new RegExp(`\\b${token}`), `${palette} lacks ${token}`);
    }
  }
});

test('top notice haptics are lazy-loaded and never fire for plain info', () => {
  const haptics = read('src/components/app/top-notice-haptics.ts');
  assert.doesNotMatch(haptics, /import \* as Haptics from 'expo-haptics'/);
  assert.match(haptics, /import\('expo-haptics'\)/);
  assert.match(haptics, /if \(type === 'info'\) return;/);
});

test('pure acknowledgements on full screens go through the top notice, not a modal', () => {
  const chatInfo = read('src/features/chat/screens/ChatInfoScreen.tsx');
  assert.match(chatInfo, /topNotice\.success\(t\('tempChats\.linkCopied'\)\)/);
  assert.match(chatInfo, /topNotice\.error\(t\('tempChats\.copyFailed'\)\)/);

  const invite = read('src/features/chat/screens/InviteGroupMembersScreen.tsx');
  assert.match(invite, /topNotice\.success\(t\('messages\.inviteGroupMembersSent'\)\)/);

  // 底部面板里的回执保留 Alert：提醒宿主挂在根视图，会被打开中的原生 Modal 盖住。
  const shareSheet = read('src/features/messages/components/ShareTempChatModal.tsx');
  assert.match(shareSheet, /Alert\.alert\(t\('tempChats\.linkCopied'\)\)/);
});
