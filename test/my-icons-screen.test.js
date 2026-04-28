const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('MyIconsScreen loads icon options and enforces the 5 icon limit', () => {
  const src = read('src/features/profile/screens/MyIconsScreen.tsx');

  assert.match(src, /fetchIconOptions/);
  assert.match(src, /updateDisplayIcons/);
  assert.match(src, /fetchCurrentUser/);
  assert.match(src, /const refreshedUser = await fetchCurrentUser\(\)/);
  assert.match(src, /最多展示 5 个图标/);
  assert.doesNotMatch(src, /保存成功/);
  assert.match(src, /systemIcons/);
  assert.match(src, /circleIcons/);
});
