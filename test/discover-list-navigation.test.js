const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const DISCOVER = 'src/features/discover/screens/DiscoverScreen.tsx';

test('discover home is a grouped list that routes to three dedicated screens', () => {
  const source = read(DISCOVER);

  assert.match(source, /t\('discover\.moments'\)/);
  assert.match(source, /t\('contacts\.circles'\)/);
  assert.match(source, /t\('discover\.plaza'\)/);
  assert.match(source, /t\('discover\.management'\)/);
  assert.match(source, /\/\(tabs\)\/discover\/moments/);
  assert.match(source, /\/\(tabs\)\/discover\/plaza/);
  assert.match(source, /\/\(tabs\)\/discover\/management/);
  assert.doesNotMatch(source, /<FilterTabs/);
  assert.doesNotMatch(source, /<MomentsFeed/);
  assert.doesNotMatch(source, /<PlazaFeed/);
  assert.doesNotMatch(source, /<MyCirclesPanel/);
});

test('discover home shows separate unread dots for moments and circle plaza', () => {
  const source = read(DISCOVER);

  assert.match(source, /useTabBadgeStore\(\(state\) => state\.discoverUnread\)/);
  assert.match(source, /useTabBadgeStore\(\(state\) => state\.signupUnread\)/);
  assert.match(source, /showIndicatorDot=\{momentsUnread > 0\}/);
  assert.match(source, /showIndicatorDot=\{plazaUnread > 0\}/);
  assert.doesNotMatch(source, /name="notifications-outline"/);
  assert.doesNotMatch(source, /<Badge/);
  assert.doesNotMatch(source, /name="search-outline"/);
  assert.doesNotMatch(source, /name="options-outline"/);
  assert.doesNotMatch(source, /name="settings-outline"/);
});

test('dedicated discover routes re-export their screens', () => {
  assert.match(
    read('app/(tabs)/discover/moments.tsx'),
    /MomentsScreen/,
  );
  assert.match(
    read('app/(tabs)/discover/plaza.tsx'),
    /CirclePlazaScreen/,
  );
  assert.match(
    read('app/(tabs)/discover/management.tsx'),
    /CircleManagementScreen/,
  );
});

test('moments screen reuses the feed and keeps its create action', () => {
  const source = read('src/features/discover/screens/MomentsScreen.tsx');

  assert.match(source, /<MomentsFeed \/>/);
  assert.match(source, /\/\(tabs\)\/discover\/create-moment/);
  assert.match(source, /name="add"/);
});

test('circle plaza screen owns discovery filter and create actions', () => {
  const source = read('src/features/discover/screens/CirclePlazaScreen.tsx');

  assert.match(source, /<PlazaFeed \/>/);
  assert.match(source, /\/\(tabs\)\/discover\/circles/);
  assert.match(source, /\/\(tabs\)\/discover\/filter/);
  assert.match(source, /\/\(tabs\)\/discover\/create-post/);
  assert.match(source, /name="search-outline"/);
  assert.match(source, /name="options-outline"/);
});

test('circle plaza owns the signup notification bell and opens signup management', () => {
  const source = read('src/features/discover/screens/CirclePlazaScreen.tsx');

  assert.match(source, /useTabBadgeStore\(\(state\) => state\.signupUnread\)/);
  assert.match(source, /name="notifications-outline"/);
  assert.match(source, /<Badge count=\{signupUnread\} \/>/);
  assert.match(source, /pathname: '\/\(tabs\)\/discover\/notification-center'/);
  assert.match(source, /params: \{ initialTab: 'circle' \}/);
});

test('notification center honors the requested initial tab', () => {
  const source = read(
    'src/features/notifications/screens/NotificationCenterScreen.tsx',
  );

  assert.match(source, /useLocalSearchParams/);
  assert.match(source, /initialTab === 'circle' \? 'circle' : 'interactive'/);
});

test('discover tab badge combines moments and signup unread state', () => {
  const source = read('app/(tabs)/_layout.tsx');

  assert.match(source, /signupUnread: state\.signupUnread/);
  assert.match(
    source,
    /discover: discoverUnread > 0 \|\| signupUnread > 0/,
  );
});

test('circle management screen reuses the panel and owns notification settings', () => {
  const source = read('src/features/discover/screens/CircleManagementScreen.tsx');

  assert.match(source, /<MyCirclesPanel \/>/);
  assert.match(source, /\/\(tabs\)\/discover\/notifications/);
  assert.match(source, /rightIcon="settings-outline"/);
});
