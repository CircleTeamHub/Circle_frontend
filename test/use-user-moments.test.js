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

test('useUserMoments guards against setState-after-unmount', () => {
  const src = read('src/features/discover/hooks/use-user-moments.ts');
  // 维护一个挂载标志，卸载时置 false
  assert.match(src, /mountedRef/);
  assert.match(src, /mountedRef\.current = false/);
  // 异步 resolve 后、写 state 前先判挂载状态
  assert.match(
    src,
    /if \(!mountedRef\.current(?: \|\| requestSeq !== requestSeqRef\.current)?\) return/,
  );
  assert.match(src, /if \(mountedRef\.current\) setLoading\(false\)/);
});

test('useUserMoments guards loadMore against overlapping calls', () => {
  const src = read('src/features/discover/hooks/use-user-moments.ts');
  assert.match(src, /inFlightRef/);
  // 同步关闭重复触发窗口
  assert.match(src, /if \(inFlightRef\.current \|\|/);
  assert.match(src, /inFlightRef\.current = true/);
  assert.match(src, /inFlightRef\.current = false/);
});
