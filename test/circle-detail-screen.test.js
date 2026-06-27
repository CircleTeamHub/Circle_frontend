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

test('CircleDetailScreen supports pull-to-refresh', () => {
  const src = read('src/features/discover/screens/CircleDetailScreen.tsx');

  assert.match(src, /RefreshControl/);
  assert.match(src, /const \[refreshing, setRefreshing\] = useState\(false\)/);
  assert.match(src, /handleRefreshCircle/);
  assert.match(src, /refreshInFlightRef/);
  assert.match(src, /circleRequestRef/);
  assert.match(src, /showInitialLoading/);
  assert.match(src, /if \(refreshInFlightRef\.current\) return;/);
  assert.match(src, /setRefreshing\(true\)/);
  assert.match(src, /loadCircle\(\{ showInitialLoading: false \}\)/);
  assert.match(src, /requestId !== circleRequestRef\.current/);
  assert.match(src, /finally\s*\{[\s\S]{0,120}mountedRef\.current[\s\S]{0,80}setRefreshing\(false\)/);
  assert.match(src, /refreshing=\{refreshing\}/);
  assert.match(src, /onRefresh=\{handleRefreshCircle\}/);
});
