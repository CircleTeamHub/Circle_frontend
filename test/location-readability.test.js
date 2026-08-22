const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

// 自己发出去的位置，坐标本来就是自己选的、选点页刚刚才请求过一轮 OSM 瓦片，
// 再让本人「轻点显示地图」纯属多余；收件人那一侧的隐私门必须保留。
test('own location bubbles show the map immediately, received ones stay gated', () => {
  const card = read('src/features/chat/components/bubbles/location-card.tsx');

  assert.match(card, /useState\(outgoing\)/);
  assert.match(card, /t\('chat\.location\.showPreview'/);
});

test('coordinate-only addresses get resolved to a real place name', () => {
  const card = read('src/features/chat/components/bubbles/location-card.tsx');

  assert.match(card, /resolvePlace/);
  assert.match(card, /isCoordinateOnlyAddress/);
  // 只在地图已经展开时才查——未展开的收到消息不许产生任何第三方请求。
  assert.match(card, /previewRevealed/);
});

test('the location card clamps long addresses instead of growing unbounded', () => {
  const card = read('src/features/chat/components/bubbles/location-card.tsx');

  // nominatim 的 display_name 能有七八段，气泡不能被它撑成一堵墙。
  assert.match(card, /numberOfLines=\{1\}/);
  assert.match(card, /numberOfLines=\{2\}/);
});

test('the picker resolves the incoming centre so send-without-touching still carries an address', () => {
  const picker = read(
    'src/features/location/components/map-location-picker-screen.tsx',
  );

  assert.match(picker, /refineInitialAddress/);
  assert.match(picker, /fetchReversePlace/);
  // 用户一旦自己选过点，晚到的初始反查必须丢弃，不能把选择覆盖回去。
  assert.match(picker, /generation !== pickGeneration/);
});

test('location map utils can tell a bare coordinate pair from a real address', () => {
  const utils = read('src/features/location/utils/location-map.ts');

  assert.match(utils, /export function isCoordinateOnlyAddress/);
});
