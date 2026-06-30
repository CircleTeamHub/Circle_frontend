const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('UserIconRow renders system badges from local artwork and circle icons in circular containers', () => {
  const row = read('src/components/ui/user-icon-row.tsx');

  assert.match(row, /export function UserIconBadge/);
  assert.match(row, /formatIconLabel/);
  assert.match(row, /compactCircle/);
  assert.match(row, /numberOfLines=\{1\}/);
  assert.match(row, /tone\s*=\s*'default'/);
  assert.match(row, /getSystemBadgeAsset/);
  assert.match(row, /systemBadgeAsset/);
  assert.match(row, /systemBadgeImage/);
  assert.match(row, /contentFit="contain"/);
  assert.doesNotMatch(row, /SystemIconArt/);
  assert.doesNotMatch(row, /PARTNER/);
  assert.match(row, /s\.circle/);
  assert.match(row, /resolveFallbackIcon/);
  assert.match(row, /function buildIconKey/);
  assert.match(row, /function isRenderableIcon/);
});
