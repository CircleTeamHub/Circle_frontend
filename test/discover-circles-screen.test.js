const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const SCREEN = 'src/features/discover/screens/DiscoverCirclesScreen.tsx';
const ROUTE = 'app/(tabs)/discover/circles.tsx';
const DISCOVER = 'src/features/discover/screens/DiscoverScreen.tsx';

test('DiscoverCirclesScreen lists all circles from the store and filters locally', () => {
  const src = read(SCREEN);
  assert.match(src, /fetchAllCircles/);
  assert.match(src, /allCircles/);
  // A text input drives live local filtering by name/desc/city.
  assert.match(src, /TextInput/);
  assert.match(src, /onChangeText=\{setQuery\}/);
  assert.match(src, /\.name\.toLowerCase\(\)\.includes/);
});

test('DiscoverCirclesScreen supports pull-to-refresh', () => {
  const src = read(SCREEN);

  assert.match(src, /const \[refreshing, setRefreshing\] = useState\(false\)/);
  assert.match(src, /handleRefreshCircles/);
  assert.match(src, /mountedRef/);
  assert.match(src, /refreshInFlightRef/);
  assert.match(src, /if \(refreshInFlightRef\.current\) return;/);
  assert.match(src, /setRefreshing\(true\)/);
  assert.match(src, /await fetchAllCircles\(\)/);
  assert.match(src, /finally\s*\{[\s\S]{0,120}mountedRef\.current[\s\S]{0,80}setRefreshing\(false\)/);
  assert.match(src, /refreshing=\{refreshing\}/);
  assert.match(src, /onRefresh=\{handleRefreshCircles\}/);
});

test('DiscoverCirclesScreen opens circle detail where join/apply lives', () => {
  const src = read(SCREEN);
  assert.match(src, /\/\(tabs\)\/discover\/circle\/\$\{encodeURIComponent/);
});

test('circles route re-exports the discover screen', () => {
  const src = read(ROUTE);
  assert.match(src, /DiscoverCirclesScreen/);
});

test('Discover header exposes a discover-circles entry', () => {
  const src = read(DISCOVER);
  assert.match(src, /handleDiscoverCirclesPress/);
  assert.match(src, /["'`]\/\(tabs\)\/discover\/circles["'`]/);
  assert.match(src, /name="search-outline"/);
});

test('circle-discovery i18n keys exist in both locales', () => {
  const zh = JSON.parse(read('src/i18n/locales/zh.json'));
  const en = JSON.parse(read('src/i18n/locales/en.json'));
  for (const loc of [zh, en]) {
    assert.ok(loc.discover.discoverCircles);
    assert.ok(loc.discover.searchCirclePlaceholder);
    assert.ok(loc.discover.noCirclesFound);
    assert.ok(loc.discover.memberCount);
  }
});
