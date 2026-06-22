const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('MomentAlbumHeader shows cover, nickname and avatar with themed fallback', () => {
  const src = read('src/features/discover/components/moment-album-header.tsx');
  assert.match(src, /coverUrl/);
  assert.match(src, /nickname/);
  assert.match(src, /Avatar/);
  assert.match(src, /from 'expo-image'/);
  assert.match(src, /useTheme\(\)/);
  assert.doesNotMatch(src, /#[0-9a-fA-F]{6}/);
  assert.match(src, /const COVER_HEIGHT/);
  assert.match(src, /const AVATAR_SIZE/);
});
