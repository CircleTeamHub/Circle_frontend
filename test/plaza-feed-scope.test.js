const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('plaza feed filter bar uses only my joined or created circles', () => {
  const source = read('src/features/discover/components/plaza-feed.tsx');

  assert.match(source, /joinedCircles/);
  assert.match(source, /createdCircles/);
  assert.match(source, /fetchMyCircles/);
  assert.doesNotMatch(source, /allCircles/);
  assert.doesNotMatch(source, /fetchAllCircles/);
});

test('plaza feed request applies saved multi-circle and city filters', () => {
  const source = read('src/features/discover/store/use-discover-store.ts');

  assert.match(source, /useDiscoverFilterStore/);
  assert.match(source, /appliedCircleIds/);
  assert.match(source, /appliedCities/);
  assert.match(source, /circleIds[,:\s]/);
  assert.match(source, /cities[,:\s]/);
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

  assert.match(source, /emptyMultiSelectIsNationwide:\s*target !== 'filter'/);
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
