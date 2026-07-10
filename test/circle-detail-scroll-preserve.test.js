const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('circle detail keeps scroll position when returning from sub-pages', () => {
  const src = read('src/features/discover/screens/CircleDetailScreen.tsx');

  // focus 回本页必须静默刷新：loading 分支会卸载整个 ScrollView，
  // 重挂后滚动位置归零（用户从入圈审核返回被弹回顶部）。
  assert.match(src, /const hasLoadedRef = useRef\(false\)/);
  assert.match(src, /hasLoadedRef\.current = true/);
  assert.match(
    src,
    /useFocusEffect\(\s*useCallback\(\(\) => \{[\s\S]*?loadCircle\(\{ showInitialLoading: !hasLoadedRef\.current \}\)/,
  );
});
