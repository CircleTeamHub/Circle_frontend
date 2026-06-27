const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('ProfileScreen shows VIP level and credit score in the gold member card', () => {
  const src = read('src/features/profile/screens/ProfileScreen.tsx');
  const memberCardBlock = src.match(/\{\/\* Member card \*\/\}[\s\S]*?<Divider \/>/)?.[0] ?? '';

  assert.match(memberCardBlock, /profile\.vipLevel/);
  assert.match(memberCardBlock, /profile\.reputationValue/);
  assert.match(src, /user\?\.vipLevel/);
  assert.match(src, /user\?\.creditScore/);
  assert.match(memberCardBlock, /VIP \{vipLevel\}/);
  assert.match(memberCardBlock, /\{creditScore\}/);
});

test('ProfileScreen removes the old green badge icon', () => {
  const src = read('src/features/profile/screens/ProfileScreen.tsx');

  assert.doesNotMatch(src, /badgeRow/);
  assert.doesNotMatch(src, /greenBadge/);
  assert.doesNotMatch(src, /colors\.success/);
});

test('ProfileScreen shows selected identity badges inside the gold member card', () => {
  const src = read('src/features/profile/screens/ProfileScreen.tsx');
  const memberCardBlock = src.match(/\{\/\* Member card \*\/\}[\s\S]*?<Divider \/>/)?.[0] ?? '';

  assert.match(src, /user\?\.displayIcons/);
  assert.match(src, /UserIconRow/);
  assert.match(memberCardBlock, /memberIdentityRow/);
  assert.match(memberCardBlock, /memberIdentityItem/);
  assert.match(src, /profile\/icons/);
  assert.match(memberCardBlock, /tone="member"/);
  assert.match(read('src/components/ui/user-icon-row.tsx'), /UserIconBadge/);
  assert.doesNotMatch(src, /Date\.now\(\) - accountCreatedAt/);
});

test('ProfileScreen keeps a visible icon-settings entry when no icons are selected', () => {
  const src = read('src/features/profile/screens/ProfileScreen.tsx');
  const memberCardBlock = src.match(/\{\/\* Member card \*\/\}[\s\S]*?<Divider \/>/)?.[0] ?? '';

  assert.match(memberCardBlock, /displayIcons\.length > 0 \?/);
  assert.match(memberCardBlock, /handleOpenIcons/);
  assert.match(memberCardBlock, /添加图标/);
  assert.match(memberCardBlock, /<Pressable[\s\S]*style=\{\[s\.memberCard, d\.memberCard\]\}[\s\S]*onPress=\{handleOpenIcons\}/);
});

test('ProfileScreen does not show membership or account status beside the moved badge', () => {
  const src = read('src/features/profile/screens/ProfileScreen.tsx');
  const memberCardBlock = src.match(/\{\/\* Member card \*\/\}[\s\S]*?<Divider \/>/)?.[0] ?? '';

  assert.doesNotMatch(memberCardBlock, /membershipTag/);
  assert.doesNotMatch(memberCardBlock, /accountStatusLabel/);
});

test('ProfileScreen refreshes current user from backend for live VIP and reputation values', () => {
  const src = read('src/features/profile/screens/ProfileScreen.tsx');

  assert.match(src, /fetchCurrentUser/);
  assert.match(src, /fetchIconOptions/);
  assert.match(src, /useFocusEffect/);
  assert.match(src, /setUser\(nextUser\)/);
  assert.match(src, /setProfileDisplayIcons/);
});

test('ProfileScreen supports pull-to-refresh for profile data', () => {
  const src = read('src/features/profile/screens/ProfileScreen.tsx');

  assert.match(src, /const \[refreshing, setRefreshing\] = useState\(false\)/);
  assert.match(src, /refreshCurrentUser/);
  assert.match(src, /handleRefreshProfile/);
  assert.match(src, /refreshInFlightRef/);
  assert.match(src, /if \(refreshInFlightRef\.current\) return;/);
  assert.match(src, /setRefreshing\(true\)/);
  assert.match(src, /await refreshCurrentUser\(\{ force: true \}\)/);
  assert.match(src, /finally\s*\{[\s\S]{0,80}setRefreshing\(false\)/);
  assert.match(src, /refreshing=\{refreshing\}/);
  assert.match(src, /onRefresh=\{handleRefreshProfile\}/);
});

test('ProfileScreen top-right settings action opens the main settings page', () => {
  const src = read('src/features/profile/screens/ProfileScreen.tsx');
  const settingsHandler = src.match(
    /const handleOpenSettings = useCallback\(\(\) => \{[\s\S]*?\}, \[router\]\);/,
  )?.[0] ?? '';

  assert.match(settingsHandler, /profile\/app-settings/);
  assert.doesNotMatch(settingsHandler, /profile\/settings/);
});
