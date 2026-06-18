const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('UserIconRow renders profile icons as circular level badges, not illustration medals', () => {
  const row = read('src/components/ui/user-icon-row.tsx');

  assert.match(row, /export function UserIconBadge/);
  assert.match(row, /formatIconLabel/);
  assert.match(row, /compactCircle/);
  assert.match(row, /innerRing/);
  assert.match(row, /colors\.memberTagBg/);
  assert.match(row, /numberOfLines=\{1\}/);
  assert.match(row, /tone\s*=\s*'default'/);
  assert.doesNotMatch(row, /SystemIconArt/);
  assert.match(row, /function buildIconKey/);
  assert.match(row, /function isRenderableIcon/);
});
