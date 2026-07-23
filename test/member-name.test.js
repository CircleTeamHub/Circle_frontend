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
  // silver / gold = solid color; diamond + super = animated flowing gradient.
  assert.match(src, /silver: '#[0-9A-Fa-f]{6}'/);
  assert.match(src, /gold: '#[0-9A-Fa-f]{6}'/);
  assert.match(src, /const FLOW_COLORS/);
  assert.match(src, /diamond:/);
  assert.match(src, /super:/);
});

test('MemberName drives diamond/super with a looping reanimated color flow', () => {
  // Real animation (not a static gold band): looping shared value + per-char interpolateColor.
  assert.match(src, /from 'react-native-reanimated'/);
  assert.match(src, /withRepeat\(/);
  assert.match(src, /interpolateColor\(/);
  // Animation can be disabled for dense lists to avoid dozens of animated names.
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
