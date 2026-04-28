const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('CircleDetailScreen exposes owner-only circle icon actions', () => {
  const src = read('src/features/discover/screens/CircleDetailScreen.tsx');

  assert.match(src, /uploadCircleIcon/);
  assert.match(src, /selectCircleIcon/);
  assert.match(src, /圈子图标/);
});
