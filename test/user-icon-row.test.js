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
  assert.match(row, /getSystemBadgeVisualTranslateY/);
  assert.match(row, /systemBadgeAsset/);
  assert.match(row, /systemBadgeScale/);
  assert.match(row, /systemBadgeTranslateY/);
  assert.match(row, /systemBadgeTransform/);
  assert.match(row, /systemBadgeImage/);
  assert.match(row, /\{ scale: systemBadgeScale \}/);
  assert.match(row, /\{ translateY: systemBadgeTranslateY \* transformSizeRatio \}/);
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
  assert.match(row, /const CIRCLE_BADGE_LABEL = '圈子徽章'/);
  assert.match(row, /icon\.type === 'SYSTEM' \? formatIconLabel\(icon\) : CIRCLE_BADGE_LABEL/);
  assert.match(row, /badgeFrame/);
  assert.match(row, /systemBadgeAsset \? s\.systemBadgeShell : s\.badgeFrame/);
  assert.match(row, /circleOrnament/);
  assert.match(row, /compactCircleOrnament/);
  assert.match(row, /smallCompactCircleOrnament/);
  assert.match(row, /s\.circleOrnament/);
  assert.match(row, /circleSlotRaised/);
  assert.match(row, /<View style=\{\[s\.circleSlot,\s*!compact && !hasExplicitSize \? s\.circleSlotRaised : null\]\}>/);
  assert.match(row, /width:\s*40,\s*\n\s*height:\s*40,/);
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

test('UserIconRow lets tight layouts cap the compact badge count via maxVisible', () => {
  const row = read('src/components/ui/user-icon-row.tsx');

  // 可选 maxVisible（默认 3）：compact 模式下按它 slice，其余折叠成 "+N"。
  assert.match(row, /maxVisible\?:\s*number/);
  assert.match(row, /maxVisible\s*=\s*3/);
  assert.match(row, /compactLimit\s*=\s*Math\.max\(1,\s*maxVisible\)/);
  assert.match(row, /safeIcons\.slice\(0,\s*compactLimit\)/);

  // 可选 showOverflowCount（默认 true）：传 false 时超出不折叠 "+N"，只固定展示前 N 枚。
  assert.match(row, /showOverflowCount\?:\s*boolean/);
  assert.match(row, /showOverflowCount\s*=\s*true/);
  assert.match(row, /compact && showOverflowCount/);
});
