const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('AdminReviewScreen supports pull-to-refresh', () => {
  const src = read('src/features/discover/screens/AdminReviewScreen.tsx');

  assert.match(src, /const \[refreshing, setRefreshing\] = useState\(false\)/);
  assert.match(src, /handleRefreshInvitations/);
  assert.match(src, /const mountedRef = useRef\(true\)/);
  assert.match(src, /const requestRef = useRef\(0\)/);
  assert.match(src, /mountedRef\.current = false/);
  assert.match(src, /const isActive = \(\) => mountedRef\.current && requestId === requestRef\.current/);
  assert.match(src, /if \(!isActive\(\)\) return;/);
  assert.match(src, /if \(isActive\(\)\) setLoading\(false\)/);
  assert.match(src, /refreshInFlightRef/);
  assert.match(src, /if \(refreshInFlightRef\.current\) return;/);
  assert.match(src, /setRefreshing\(true\)/);
  assert.match(src, /await loadData\(\)/);
  assert.match(src, /if \(mountedRef\.current\) setRefreshing\(false\)/);
  assert.match(src, /refreshing=\{refreshing\}/);
  assert.match(src, /onRefresh=\{handleRefreshInvitations\}/);
});
