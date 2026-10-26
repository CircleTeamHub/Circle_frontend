const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) =>
  fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const src = read('src/components/ui/member-name.tsx');
const rootLayout = read('app/_layout.tsx');
const animationSrc = read('src/components/ui/member-name-animation.tsx');

test('MemberName colors names by membership tier (name-color benefit)', () => {
  // Tier resolved from vipLevel via the shared single-source mapping.
  assert.match(src, /getMembershipTierForVipLevel/);
  // silver / gold / diamond = solid color; super = animated flow.
  assert.match(src, /silver: '#[0-9A-Fa-f]{6}'/);
  assert.match(src, /gold: '#[0-9A-Fa-f]{6}'/);
  assert.match(src, /diamond: '#[0-9A-Fa-f]{6}'/);
  assert.match(src, /const FLOW_COLORS/);
  assert.match(src, /super:/);
});

test('MemberName renders diamond as a solid purple while super uses a looping flow', () => {
  // 钻石 = 纯紫色（在 SOLID_COLOR），不再走渐变 / STATIC_GRADIENT_TIERS。
  assert.match(src, /diamond: '#[0-9A-Fa-f]{6}'/);
  assert.doesNotMatch(src, /const STATIC_GRADIENT_TIERS/);
  assert.doesNotMatch(src, /diamond:\s*\[/); // diamond 不再是渐变色带数组
  // 仅顶档 super 流动(且需调用处显式打开)。
  assert.match(src, /animated && tier === 'super'/);
  assert.doesNotMatch(src, /tier === 'diamond'/);

  // Super still runs a real looping clock; the flow itself is a separate,
  // platform-split renderer (Skia on native, see the test below).
  assert.match(animationSrc, /withRepeat\(/);
  assert.match(src, /<MemberNameFlow/);
  // Animation is opt-in: dense lists get the static gradient by default.
  assert.match(src, /animated = false/);
});

// 回归:旧实现逐字 useAnimatedStyle 改文字颜色,每帧都触发布局树提交 + 文字重排,
// 顶档会员一在屏幕上手机就发烫。原生端的流光必须由 Skia 在 UI 线程直接画。
test('the native flow is painted by Skia, never by per-frame animated React styles', () => {
  const flow = read('src/components/ui/member-name-flow.tsx');
  assert.match(flow, /from '@shopify\/react-native-skia'/);
  assert.match(flow, /useDerivedValue\(/);
  assert.doesNotMatch(flow, /useAnimatedStyle|useAnimatedProps|interpolateColor/);
  assert.doesNotMatch(src, /useAnimatedStyle|useAnimatedProps|interpolateColor/);
  // Web 没有加载 CanvasKit,沿用逐字插值;两份必须同扩展名,否则 Metro 会先命中 .tsx。
  assert.ok(
    fs.existsSync(path.join(__dirname, '..', 'src/components/ui/member-name-flow.web.tsx')),
    'web needs its own flow renderer (Skia is native-only here)',
  );
});

test('only profile headers opt into the flowing animation; every list stays static', () => {
  const ALLOWED = new Set([
    'src/features/profile/screens/ProfileScreen.tsx',
    'src/features/user/screens/UserProfileScreen.tsx',
  ]);
  const root = path.join(__dirname, '..');
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (/\.tsx$/.test(entry.name) && !/\.spec\.tsx$/.test(entry.name)) files.push(rel);
    }
  };
  walk('src');
  walk('app');

  const optedIn = new Set();
  for (const rel of files) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    for (const block of text.match(/<MemberName\b[\s\S]*?\/>/g) ?? []) {
      if (/\banimated\b(?!=\{false\})/.test(block)) optedIn.add(rel.split(path.sep).join('/'));
    }
  }
  for (const rel of optedIn) {
    assert.ok(ALLOWED.has(rel), `${rel} animates MemberName; lists and feeds must stay static`);
  }
  for (const rel of ALLOWED) {
    assert.ok(optedIn.has(rel), `${rel} lost its flowing header name`);
  }
});

test('MemberName degrades to a plain name for non-members / missing vipLevel', () => {
  assert.match(src, /if \(!tier\)/);
  // Multi-byte safe splitting so emoji / surrogate pairs are not mis-colored.
  assert.match(src, /Array\.from\(name\)/);
});

test('ProfileScreen renders the current user name through MemberName', () => {
  const profile = read('src/features/profile/screens/ProfileScreen.tsx');
  assert.match(profile, /from "@\/components\/ui\/member-name"/);
  assert.match(profile, /<MemberName[\s\S]*?vipLevel=\{vipLevel\}/);
});

test('Plaza author names pass vipLevel from the author payload', () => {
  const card = read('src/features/discover/components/plaza-post-card.tsx');
  assert.match(card, /<MemberName[\s\S]*?vipLevel=\{post\.author\.vipLevel\}/);
});

test('MemberName solid tier colors stay readable on both theme surfaces', () => {
  // WCAG 相对亮度 + 对比度。名字是常文本，目标 ≥4.5:1。
  const lum = (hex) => {
    const c = hex.replace('#', '');
    const ch = (i) => parseInt(c.slice(i, i + 2), 16) / 255;
    const f = (x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(ch(0)) + 0.7152 * f(ch(2)) + 0.0722 * f(ch(4));
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const grab = (theme, tier) => {
    const block = src.slice(src.indexOf(`${theme}: {`));
    return block.match(new RegExp(`${tier}: '(#[0-9A-Fa-f]{6})'`))?.[1];
  };

  for (const tier of ['silver', 'gold', 'diamond']) {
    const light = grab('light', tier);
    const dark = grab('dark', tier);
    assert.ok(
      light && ratio(light, '#FFFFFF') >= 4.5,
      `${tier} 浅色变体 ${light} 白底对比度 ${light && ratio(light, '#FFFFFF').toFixed(2)} < 4.5`,
    );
    assert.ok(
      dark && ratio(dark, '#1C1C1E') >= 4.5,
      `${tier} 深色变体 ${dark} 深底对比度 ${dark && ratio(dark, '#1C1C1E').toFixed(2)} < 4.5`,
    );
  }
  // 组件按当前主题取纯色变体。
  assert.match(src, /useColorScheme\(\)/);
  assert.match(src, /SOLID_COLOR\[scheme\]/);
});

test('UserProfileScreen passes the loaded vipLevel to MemberName (no redundant batch lookup)', () => {
  // 资料响应已带 vipLevel(同一屏用来选头像框),名字也应直接内联，避免先渲染无特效再补查。
  const screen = read('src/features/user/screens/UserProfileScreen.tsx');
  assert.match(screen, /<MemberName[\s\S]*?vipLevel=\{profileVipLevel\}/);
});

test('MemberName shares one app-scoped animation clock', () => {
  const animationPath = path.join(
    __dirname,
    '..',
    'src/components/ui/member-name-animation.tsx',
  );
  assert.ok(
    fs.existsSync(animationPath),
    'expected a shared MemberName animation provider',
  );

  const animation = fs.readFileSync(animationPath, 'utf8');
  assert.match(animation, /export function MemberNameAnimationProvider/);
  assert.match(rootLayout, /<MemberNameAnimationProvider>/);
  assert.match(src, /useMemberNameAnimation\(/);
  assert.doesNotMatch(src, /useSharedValue\(/);
});

// 注意:这里只钉「文件在、行为用例在」。共享时钟的实际生命周期
// (后台暂停/恢复、Reduce Motion 开关、最后一个消费者才停、监听清理)
// 由 src/components/ui/member-name-animation.spec.tsx 用真实挂载/卸载验证 ——
// 读源码的断言在回调空转、引用计数写错、监听不清理时照样绿,不能算覆盖。
test('the shared MemberName animation clock has behavioral coverage', () => {
  const animationPath = path.join(
    __dirname,
    '..',
    'src/components/ui/member-name-animation.tsx',
  );
  assert.ok(
    fs.existsSync(animationPath),
    'expected a shared MemberName animation provider',
  );

  const specPath = path.join(
    __dirname,
    '..',
    'src/components/ui/member-name-animation.spec.tsx',
  );
  assert.ok(
    fs.existsSync(specPath),
    'lifecycle behavior must be covered by a mounted-component spec, not source greps',
  );
});
