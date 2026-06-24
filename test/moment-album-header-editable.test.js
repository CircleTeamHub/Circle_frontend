const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('MomentAlbumHeader makes the cover tappable (no persistent hint) when onPressCover is set', () => {
  const src = read('src/features/discover/components/moment-album-header.tsx');
  assert.match(src, /onPressCover\?:\s*\(\)\s*=>\s*void/);
  assert.match(src, /Pressable/);
  // 仍主题化、无硬编码色值
  assert.match(src, /useTheme\(\)/);
  assert.doesNotMatch(src, /#[0-9a-fA-F]{6}/);
  // 不再显示持久的「换封面」提示
  assert.doesNotMatch(src, /moment\.changeCover/);
});
