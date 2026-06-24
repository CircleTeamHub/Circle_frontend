const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('MomentAlbumHeader avatar is a rounded square (not circle-in-square)', () => {
  const src = read('src/features/discover/components/moment-album-header.tsx');
  assert.match(src, /shape="square"/);
});

test('MomentAlbumHeader keeps the nickname legible over the cover', () => {
  const src = read('src/features/discover/components/moment-album-header.tsx');
  // 昵称上移到封面之上，不再落到下方白色区域
  assert.match(src, /alignItems:\s*'flex-start'/);
  // 强黑色描边，保证白字在浅色照片上也可读
  assert.match(src, /textShadowColor:\s*colors\.black/);
});
