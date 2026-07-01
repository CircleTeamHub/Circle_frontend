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
  assert.match(row, /getSystemBadgeVisualScale/);
  assert.match(row, /systemBadgeAsset/);
  assert.match(row, /systemBadgeScale/);
  assert.match(row, /systemBadgeImage/);
  assert.match(row, /transform: \[\{ scale: systemBadgeScale \}\]/);
  assert.match(row, /dense\s*=\s*false/);
  assert.match(row, /denseItem/);
  assert.match(row, /denseLabel/);
  assert.match(row, /marginTop:\s*-6/);
  assert.match(row, /dense\s*\?\s*s\.denseLabel\s*:\s*null/);
  assert.match(row, /contentFit="contain"/);
  assert.doesNotMatch(row, /SystemIconArt/);
  assert.doesNotMatch(row, /PARTNER/);
  assert.match(row, /s\.circle/);
  assert.match(row, /resolveFallbackIcon/);
  assert.match(row, /function buildIconKey/);
  assert.match(row, /function isRenderableIcon/);
});

test('UserIconRow supports a smaller compact size for dense inline contexts', () => {
  const row = read('src/components/ui/user-icon-row.tsx');

  assert.match(row, /type CompactSize = 'default' \| 'small'/);
  assert.match(row, /compactSize\?: CompactSize/);
  assert.match(row, /smallCompactCircle/);
  assert.match(row, /smallCompactSystemBadgeShell/);
  assert.match(row, /smallCompactCount/);
  assert.match(row, /compactSize === 'small'/);
});
