const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('plaza feed filter bar uses membership-scoped circles including owned circles', () => {
  const source = read('src/features/discover/components/plaza-feed.tsx');

  assert.match(source, /joinedCircles/);
  assert.match(source, /createdCircles/);
  assert.match(source, /fetchMyCircles/);
  assert.doesNotMatch(source, /allCircles/);
  assert.doesNotMatch(source, /fetchAllCircles/);
});

test('plaza feed preserves backend circle ids instead of silently dropping them', () => {
  const feed = read('src/features/discover/components/plaza-feed.tsx');
  const store = read('src/features/discover/store/use-discover-store.ts');

  assert.doesNotMatch(feed, /isBackendUuid/);
  assert.doesNotMatch(store, /isBackendUuid/);
  assert.match(store, /const cappedCircleIds = clampCircleFilterIds\(appliedCircleIds\);/);
  assert.match(store, /selectedCircleId: circleId,/);
});

test('plaza feed does not paginate while the first page is still empty', () => {
  const source = read('src/features/discover/components/plaza-feed.tsx');

  assert.match(source, /plazaPosts\.length > 0/);
  assert.match(source, /plazaPosts\.length,\s*plazaLoading,\s*plazaHasMore,\s*fetchPlazaPosts/);
});

test('plaza feed selected-circle empty state explains ended posts are hidden', () => {
  const source = read('src/features/discover/components/plaza-feed.tsx');

  assert.match(source, /selectedCircleId/);
  assert.match(source, /discover\.noActiveActivity/);
  assert.match(source, /discover\.endedActivityHiddenHint/);
});

test('plaza feed empty state never tells joined users to join a circle', () => {
  const source = read('src/features/discover/components/plaza-feed.tsx');
  const emptyStateBlock = source.match(/const ListEmpty = !plazaLoading \? \([\s\S]*?\n  \) : null;/)?.[0] ?? '';

  assert.match(emptyStateBlock, /discover\.noActiveActivity/);
  assert.match(emptyStateBlock, /discover\.endedActivityHiddenHint/);
  assert.doesNotMatch(emptyStateBlock, /discover\.joinCircleHint/);
});

test('plaza feed keeps circle shortcuts independent from the global filter', () => {
  const source = read('src/features/discover/components/plaza-feed.tsx');

  assert.match(source, /orderCircleShortcuts\(myPlazaCircles/);
  assert.doesNotMatch(source, /applyCircleFilter\(myPlazaCircles/);
  assert.doesNotMatch(source, /activeFilterSummary/);
  assert.doesNotMatch(source, /clearFilter/);
});

test('circle filter bar always labels all as all', () => {
  const source = read('src/features/discover/components/circle-filter-bar.tsx');

  assert.match(source, /t\('common\.all'\)/);
  assert.doesNotMatch(source, /isFiltered/);
  assert.doesNotMatch(source, /discover\.filter\.filteredAll/);
});

test('plaza feed lets users edit persisted circle shortcut order from the right side', () => {
  const feed = read('src/features/discover/components/plaza-feed.tsx');
  const bar = read('src/features/discover/components/circle-filter-bar.tsx');
  const sheet = read('src/features/discover/components/circle-shortcut-order-sheet.tsx');

  assert.match(feed, /useCircleShortcutOrderStore/);
  assert.match(feed, /orderCircleShortcuts/);
  assert.match(feed, /CircleShortcutOrderSheet/);
  assert.match(bar, /onEditOrder/);
  assert.match(bar, /reorder-three-outline/);
  assert.match(bar, /translateX:\s*Spacing\.xs/);
  assert.match(sheet, /PanResponder/);
  assert.match(sheet, /getDragResponder/);
  assert.match(sheet, /scrollEnabled=\{!draggingCircleId\}/);
  assert.match(sheet, /reorderCircleShortcut/);
  assert.match(sheet, /reorder-three-outline/);
  assert.match(sheet, /new Animated\.Value\(0\)/);
  assert.match(sheet, /translateY:\s*dragY/);
  assert.match(sheet, /Animated\.View/);
  assert.match(sheet, /draggingRow/);
  assert.match(sheet, /dragY\.stopAnimation\(\)/);
  assert.doesNotMatch(sheet, /Animated\.spring\(dragY/);
  assert.doesNotMatch(sheet, /colors\.primaryLight/);
  assert.doesNotMatch(sheet, /transform:\s*isDragging\s*\?/);
  assert.doesNotMatch(sheet, /chevron-up/);
  assert.doesNotMatch(sheet, /chevron-down/);
});

test('plaza feed request applies saved multi-circle and city filters only for all', () => {
  const source = read('src/features/discover/store/use-discover-store.ts');

  assert.match(source, /useDiscoverFilterStore/);
  assert.match(source, /appliedCircleIds/);
  assert.match(source, /appliedCities/);
  assert.match(source, /circleIds[,:\s]/);
  assert.match(source, /cities[,:\s]/);
  assert.match(source, /selectedCircleId \|\| cappedCircleIds\.length === 0/);
});

test('plaza feed request caps saved multi-circle filters before sending', () => {
  const source = read('src/features/discover/store/use-discover-store.ts');

  assert.match(source, /clampCircleFilterIds/);
  assert.match(source, /clampCircleFilterIds\(appliedCircleIds\)/);
});

test('discover filter picker only lists my joined or created circles', () => {
  const filterScreen = read('src/features/discover/screens/FilterScreen.tsx');
  const pickerScreen = read('src/features/discover/screens/SelectFilterCirclesScreen.tsx');

  assert.match(filterScreen, /joinedCircles/);
  assert.match(filterScreen, /createdCircles/);
  assert.match(filterScreen, /fetchMyCircles/);
  assert.doesNotMatch(filterScreen, /allCircles/);
  assert.doesNotMatch(filterScreen, /fetchAllCircles/);

  assert.match(pickerScreen, /joinedCircles/);
  assert.match(pickerScreen, /createdCircles/);
  assert.match(pickerScreen, /fetchMyCircles/);
  assert.doesNotMatch(pickerScreen, /allCircles/);
  assert.doesNotMatch(pickerScreen, /fetchAllCircles/);
});

test('discover filter screens always refresh my circles instead of trusting stale account state', () => {
  const filterScreen = read('src/features/discover/screens/FilterScreen.tsx');
  const pickerScreen = read('src/features/discover/screens/SelectFilterCirclesScreen.tsx');

  assert.match(filterScreen, /useEffect\(\(\)\s*=>\s*\{\s*fetchMyCircles\(\);/s);
  assert.doesNotMatch(filterScreen, /joinedCircles\.length === 0 && createdCircles\.length === 0/);

  assert.match(pickerScreen, /useEffect\(\(\)\s*=>\s*\{\s*fetchMyCircles\(\);/s);
  assert.doesNotMatch(pickerScreen, /joinedCircles\.length === 0 && createdCircles\.length === 0/);
});

test('discover city filter starts with no city filter instead of nationwide', () => {
  const source = read('src/features/discover/screens/SelectCityScreen.tsx');

  // 只有建圈(circle)空选才视为「全国」；筛选(filter)与发帖(post)空选 = 不限定。
  assert.match(source, /emptyMultiSelectIsNationwide:\s*target === 'circle'/);
});

test('discover filter screen does not reset draft selections when returning from child pickers', () => {
  const source = read('src/features/discover/screens/FilterScreen.tsx');

  assert.match(source, /useEffect\(\(\)\s*=>\s*\{\s*loadDraftFromApplied\(\);/s);
  assert.doesNotMatch(source, /useFocusEffect\([\s\S]*loadDraftFromApplied/);
});

test('discover filter chips use a neutral close affordance', () => {
  const source = read('src/features/discover/screens/FilterScreen.tsx');

  assert.doesNotMatch(source, /chipRemove:\s*\{\s*backgroundColor:\s*colors\.error\s*\}/);
  assert.doesNotMatch(source, /Ionicons name="remove"/);
  assert.match(source, /Ionicons name="close"/);
});

test('discover header filter button does not show an applied-filter dot', () => {
  const source = read('src/features/discover/screens/DiscoverScreen.tsx');

  assert.doesNotMatch(source, /filterDot/);
  assert.doesNotMatch(source, /hasActiveFilter/);
  assert.doesNotMatch(source, /useDiscoverFilterStore/);
});
