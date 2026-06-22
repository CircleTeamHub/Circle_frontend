const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('MomentAlbumRow renders date column + content + grid + social, themed', () => {
  const src = read('src/features/discover/components/moment-album-row.tsx');
  assert.match(src, /showDate/);
  assert.match(src, /getAlbumDateParts/);
  assert.match(src, /ImageGrid/);
  assert.match(src, /containerWidth=/); // 给九宫格传相册列宽
  assert.match(src, /formatRelativeTime/);
  // 主题：用 useTheme，不硬编码颜色
  assert.match(src, /useTheme\(\)/);
  assert.doesNotMatch(src, /#[0-9a-fA-F]{6}/);
  // 无重复头像（相册同一人）
  assert.doesNotMatch(src, /Avatar/);
});
