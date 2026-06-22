const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('UserProfileScreen wires the moments row to the album route', () => {
  const src = read('src/features/user/screens/UserProfileScreen.tsx');
  assert.match(src, /getUserMomentsHref/);
  assert.match(src, /handleOpenMoments/);
  assert.match(src, /id === 'moments'/);
});
