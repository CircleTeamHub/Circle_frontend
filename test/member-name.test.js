const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) =>
  fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const src = read('src/components/ui/member-name.tsx');

test('MemberName colors names by membership tier (name-color benefit)', () => {
  // Tier resolved from vipLevel via the shared single-source mapping.
  assert.match(src, /getMembershipTierForVipLevel/);
  // silver / gold = solid color; diamond = static cool gradient; super = animated flow.
  assert.match(src, /silver: '#[0-9A-Fa-f]{6}'/);
  assert.match(src, /gold: '#[0-9A-Fa-f]{6}'/);
  assert.match(src, /const FLOW_COLORS/);
  assert.match(src, /diamond:/);
  assert.match(src, /super:/);
});

test('MemberName keeps diamond gradient static while super uses a looping flow', () => {
  assert.match(src, /const STATIC_GRADIENT_TIERS/);
  assert.match(src, /STATIC_GRADIENT_TIERS\.has\(tier\)/);
  assert.match(src, /const isFlow = tier === 'super'/);
  assert.doesNotMatch(src, /const isFlow = tier === 'diamond' \|\| tier === 'super'/);
  assert.match(src, /diamond:\s*\[\s*'#7CCBFF'/);
  assert.match(src, /'#5B7CFA'/);
  assert.match(src, /'#B7A8FF'/);
  assert.doesNotMatch(src, /diamond:\s*\[[\s\S]*?'#FF3B30'/);
  assert.doesNotMatch(src, /diamond:\s*\[[\s\S]*?'#FFCC00'/);
  assert.doesNotMatch(src, /diamond:\s*\[[\s\S]*?'#34C759'/);

  // Super still uses real animation: looping shared value + per-char interpolateColor.
  assert.match(src, /from 'react-native-reanimated'/);
  assert.match(src, /withRepeat\(/);
  assert.match(src, /interpolateColor\(/);
  // Animation can be disabled for dense lists; diamond is static regardless.
  assert.match(src, /animated = true/);
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

  for (const tier of ['silver', 'gold']) {
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
