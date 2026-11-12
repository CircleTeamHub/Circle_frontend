const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('nine-grid cells split their real container instead of a width guessed from the screen', () => {
  // Cells used to be sized in pixels from "screen width - assumed padding". Pages with more
  // padding than assumed (plaza cards, post detail) pushed the third cell onto the next row.
  const grid = read('src/features/discover/components/image-grid.tsx');
  assert.match(grid, /export function NineGrid/);
  assert.match(grid, /cell: \{ flex: 1, aspectRatio: 1 \}/);
  assert.match(grid, /single: \{ width: '65%', aspectRatio: 1 \}/);
  assert.doesNotMatch(grid, /containerWidth/);

  // The mixed photo/video grid shares the same layout.
  const media = read('src/features/discover/components/moment-media.tsx');
  assert.match(media, /<NineGrid/);
  assert.doesNotMatch(media, /containerWidth/);
});
