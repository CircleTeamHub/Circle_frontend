const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('MomentAlbumHeader avatar is a rounded square (not circle-in-square)', () => {
  const src = read('src/features/discover/components/moment-album-header.tsx');
  assert.match(src, /shape="square"/);
  assert.match(src, /const AVATAR_SIZE = 76/);
});

test('MomentAlbumHeader keeps the nickname legible over the cover', () => {
  const src = read('src/features/discover/components/moment-album-header.tsx');
  // 昵称上移到封面之上，不再落到下方白色区域
  assert.match(src, /alignItems:\s*'flex-start'/);
  // 强黑色描边，保证白字在浅色照片上也可读
  assert.match(src, /textShadowColor:\s*colors\.black/);
});

test('MomentAlbumHeader slightly zooms the cover and lowers only the avatar', () => {
  const src = read('src/features/discover/components/moment-album-header.tsx');

  assert.match(src, /const COVER_IMAGE_SCALE = 1\.04/);
  assert.match(src, /const AVATAR_DOWN_OFFSET = 20/);
  assert.match(src, /const COVER_OVERLAP_EXTENSION = AVATAR_DOWN_OFFSET/);
  assert.match(src, /const COVER_VISIBLE_HEIGHT = COVER_HEIGHT \+ COVER_OVERLAP_EXTENSION/);
  assert.match(src, /transform:\s*\[\{ scale: COVER_IMAGE_SCALE \}\]/);
  assert.match(src, /marginTop:\s*AVATAR_DOWN_OFFSET/);
  assert.match(src, /height:\s*COVER_VISIBLE_HEIGHT/);
  assert.match(src, /scale:\s*1 \+ pull \/ COVER_VISIBLE_HEIGHT/);
  assert.match(
    src,
    /height:\s*COVER_HEIGHT \+\s*AVATAR_SIZE \/ 2 \+\s*AVATAR_DOWN_OFFSET \+\s*SIGNATURE_GAP \+\s*SIGNATURE_HEIGHT/,
  );
});

test('MomentAlbumHeader renders the profile signature under the avatar', () => {
  const src = read('src/features/discover/components/moment-album-header.tsx');

  assert.match(src, /signature\?:\s*string \| null/);
  assert.match(src, /const trimmedSignature = signature\?\.trim\(\)/);
  assert.match(src, /style=\{\[s\.signature, d\.signature\]\}/);
  assert.match(src, /\{trimmedSignature\}/);
  assert.match(src, /avatarColumn/);
});
