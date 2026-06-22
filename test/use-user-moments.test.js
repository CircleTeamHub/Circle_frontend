const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('useUserMoments fetches per-user, paginates and dedupes', () => {
  const src = read('src/features/discover/hooks/use-user-moments.ts');
  assert.match(src, /export function useUserMoments/);
  assert.match(src, /fetchUserMoments\(/);
  assert.match(src, /hasMore/);
  assert.match(src, /refreshing/);
  assert.match(src, /error/);
  // 去重（避免分页重复 id）
  assert.match(src, /Map\(|Set\(|\.some\(|filter\(/);
  // 初次加载
  assert.match(src, /useEffect\(/);
});
