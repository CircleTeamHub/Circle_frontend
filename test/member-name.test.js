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
