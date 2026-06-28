const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('UserMomentsScreen lets only the owner change the cover', () => {
  const src = read('src/features/discover/screens/UserMomentsScreen.tsx');
  assert.match(src, /useAuthStore/);
  assert.match(src, /useChangeCover/);
  assert.match(src, /onPressCover/);
  // 仅自己相册才接上更换封面
  assert.match(src, /isOwn/);
  assert.match(src, /=== canonicalUserId/);
});
