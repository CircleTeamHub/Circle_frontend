const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('UserIconRow uses dedicated vector artwork for VIP and newcomer system icons', () => {
  const row = read('src/components/ui/user-icon-row.tsx');
  const art = read('src/components/ui/system-icon-art.tsx');

  assert.match(row, /SystemIconArt/);
  assert.match(row, /systemKey === 'VIP'/);
  assert.match(row, /systemKey === 'NEW_USER'/);
  assert.match(row, /function buildIconKey/);
  assert.match(row, /function isRenderableIcon/);
  assert.match(art, /react-native-svg/);
  assert.match(art, /LinearGradient/);
  assert.match(art, /VIP/);
  assert.match(art, /NEW_USER/);
});
