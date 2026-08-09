const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

// handleSearch 只挡了 loading、没挡 loadingMore:关键词 A 的翻页请求还在途时
// 用户改搜 B 是允许的,等 A 那页回来时会无条件 append 进 B 的结果里,
// 还把 B 的游标覆盖成 A 的 —— 列表混着两次搜索的命中,往下翻继续翻 A。
test('text search discards pages that belong to a superseded query', () => {
  const screen = read('src/features/chat/screens/ChatHistoryTextScreen.tsx');

  assert.match(screen, /const requestGenerationRef = useRef\(0\)/);
  // 新搜索递增世代 = 作废所有在途请求。
  assert.match(
    screen,
    /const generation = \(requestGenerationRef\.current \+= 1\)/,
  );
  // 翻页在发起时记下当时的世代。
  assert.match(screen, /const generation = requestGenerationRef\.current;\s*\n\s*setLoadingMore\(true\)/);
  // 落地前对账:过期就直接丢,绝不 append、绝不动游标。
  const guards = screen.match(
    /if \(generation !== requestGenerationRef\.current\) return;/g,
  );
  assert.ok(guards && guards.length >= 4, `expected 4 staleness guards, got ${guards?.length}`);
  const loadMore = screen.match(
    /const handleLoadMore = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[conversationID, hasMore, loadingMore\]\);/,
  )?.[0];
  assert.ok(loadMore, 'handleLoadMore block not found');
  assert.ok(
    loadMore.indexOf('if (generation !== requestGenerationRef.current) return;') <
      loadMore.indexOf('setResults((prev)'),
    'the staleness guard must run before results are appended',
  );
});

test('the staleness guards cannot wedge the loading flags', () => {
  const screen = read('src/features/chat/screens/ChatHistoryTextScreen.tsx');

  // loading 归「最新那次搜索」所有,过期请求不能替它关掉……
  assert.match(
    screen,
    /if \(generation === requestGenerationRef\.current\) setLoading\(false\)/,
  );
  // ……但空关键词那条早退路径已经递增过世代,在途请求的 finally 会跳过收尾,
  // 所以它必须自己关,否则 loading 永远为 true、`if (loading) return` 把搜索锁死。
  assert.match(
    screen,
    /setHasMore\(false\);\s*\n(\s*\/\/[^\n]*\n)*\s*setLoading\(false\);\s*\n\s*return;/,
  );
  // loadingMore 只是本次翻页的进度位:无条件收,否则新关键词从此翻不了页。
  assert.doesNotMatch(
    screen,
    /if \(generation === requestGenerationRef\.current\) setLoadingMore\(false\)/,
  );
});
