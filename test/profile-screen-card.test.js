const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('ProfileScreen shows effective membership label and credit score in the gold member card', async () => {
  const src = read('src/features/profile/screens/ProfileScreen.tsx');
  const memberCardBlock = src.match(/\{\/\* Member card \*\/\}[\s\S]*?<Divider \/>/)?.[0] ?? '';
  const { getMembershipTierForVipLevel } = await import(
    pathToFileURL(
      path.join(__dirname, '..', 'src/features/profile/membership-plans.ts'),
    ).href
  );

  assert.match(memberCardBlock, /profile\.vipLevel/);
  assert.match(memberCardBlock, /profile\.reputationValue/);
  assert.match(src, /user\?\.vipLevel/);
  assert.match(src, /user\?\.creditScore/);
  assert.match(src, /getMembershipTierForVipLevel\(vipLevel\)/);
  assert.match(src, /const membershipLabel = membershipTier/);
  assert.match(src, /defaultValue: '普通用户'/);
  assert.match(src, /super: ["']永久会员["']/);
  assert.match(memberCardBlock, /\{membershipLabel\}/);
  assert.doesNotMatch(memberCardBlock, /VIP \{vipLevel\}/);
  assert.match(memberCardBlock, /\{creditScore\}/);
  assert.equal(getMembershipTierForVipLevel(0), null);
  assert.equal(getMembershipTierForVipLevel(4), 'super');
  assert.equal(getMembershipTierForVipLevel(5), 'super');
  assert.equal(getMembershipTierForVipLevel(99), 'super');
});

test('ProfileScreen gives VIP and reputation stats independent value-based backgrounds', () => {
  const src = read('src/features/profile/screens/ProfileScreen.tsx');
  const memberCardBlock = src.match(/\{\/\* Member card \*\/\}[\s\S]*?<Divider \/>/)?.[0] ?? '';
  const memberStatsBlock = memberCardBlock.match(
    /<View style=\{s\.memberStatsPanel\}>[\s\S]*?style=\{s\.memberCardHeader\}/,
  )?.[0] ?? '';
  const memberStatsPanelStyle = src.match(/memberStatsPanel:\s*\{[\s\S]*?\n  \},/)?.[0] ?? '';
  const memberStatCellStyle = src.match(/memberStatCell:\s*\{[\s\S]*?\n  \},/)?.[0] ?? '';

  assert.match(src, /getVipStatBackground/);
  assert.match(src, /getCreditStatBackground/);
  assert.match(src, /getVipStatTextColor/);
  assert.match(src, /getCreditStatTextColor/);
  assert.match(src, /vipStatBackground/);
  assert.match(src, /creditStatBackground/);
  assert.match(src, /vipStatTextColor/);
  assert.match(src, /creditStatTextColor/);
  assert.match(src, /handleOpenMemberCenter/);
  assert.match(src, /handleOpenCreditScore/);
  assert.match(src, /profile\/member-center/);
  assert.match(src, /profile\/credit-score/);
  assert.match(memberStatsPanelStyle, /gap:\s*8/);
  assert.doesNotMatch(memberStatsPanelStyle, /borderWidth/);
  assert.match(memberStatCellStyle, /gap:\s*3/);
  assert.match(memberStatCellStyle, /borderRadius:\s*Radius\.md/);
  assert.match(memberStatCellStyle, /borderWidth:\s*StyleSheet\.hairlineWidth/);
  assert.match(memberStatCellStyle, /paddingVertical:\s*9/);
  assert.match(memberCardBlock, /style=\{\[s\.memberStatCell,\s*d\.memberStat,\s*\{ backgroundColor: vipStatBackground \}\]\}/);
  assert.match(memberCardBlock, /style=\{\[s\.memberStatCell,\s*d\.memberStat,\s*\{ backgroundColor: creditStatBackground \}\]\}/);
  assert.match(memberStatsBlock, /onPress=\{handleOpenMemberCenter\}/);
  assert.match(memberStatsBlock, /onPress=\{handleOpenCreditScore\}/);
  assert.match(memberCardBlock, /style=\{\[d\.memberStatLabel,\s*\{ color: vipStatTextColor \}\]\}/);
  assert.match(memberCardBlock, /style=\{\[d\.memberStatValue,\s*\{ color: creditStatTextColor \}\]\}/);
  assert.doesNotMatch(memberCardBlock, /memberStatDivider/);
  assert.doesNotMatch(memberCardBlock, /style=\{\[s\.memberStatsPanel,\s*d\.memberStat\]\}[\s\S]*?backgroundColor:\s*colors\.memberTagBg/);
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
  assert.match(src, /profile\/decorations/);
  assert.match(memberCardBlock, /tone="member"/);
  assert.match(read('src/components/ui/user-icon-row.tsx'), /UserIconBadge/);
  assert.doesNotMatch(src, /Date\.now\(\) - accountCreatedAt/);
});

test('ProfileScreen keeps a visible decorations entry when no icons are selected', () => {
  const src = read('src/features/profile/screens/ProfileScreen.tsx');
  const memberCardBlock = src.match(/\{\/\* Member card \*\/\}[\s\S]*?<Divider \/>/)?.[0] ?? '';

  assert.match(memberCardBlock, /displayIcons\.length > 0 \?/);
  assert.match(memberCardBlock, /handleOpenDecorations/);
  assert.match(memberCardBlock, /profile\.addIcon/);
  assert.match(memberCardBlock, /profile\.myDecorations/);
  assert.match(memberCardBlock, /<Pressable[\s\S]*style=\{s\.memberCardHeader\}[\s\S]*onPress=\{handleOpenDecorations\}/);
  assert.match(memberCardBlock, /<Pressable[\s\S]*style=\{s\.memberIdentityRow\}[\s\S]*onPress=\{handleOpenDecorations\}/);
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
  assert.match(src, /setUser\(\{/);
  assert.match(src, /displayIcons:\s*nextIcons\.displayIcons/);
  assert.match(src, /setProfileDisplayIcons/);
});

test('ProfileScreen preserves icon-options badges when refreshed user has stale displayIcons', () => {
  const src = read('src/features/profile/screens/ProfileScreen.tsx');
  const refreshBlock = src.match(
    /const refreshCurrentUser = useCallback\([\s\S]*?useFocusEffect/,
  )?.[0] ?? '';

  assert.match(refreshBlock, /displayIcons:\s*nextIcons\.displayIcons/);
  assert.doesNotMatch(refreshBlock, /setUser\(nextUser\)/);
});

test('ProfileScreen supports pull-to-refresh for profile data', () => {
  const src = read('src/features/profile/screens/ProfileScreen.tsx');

  assert.match(src, /const \[refreshing, setRefreshing\] = useState\(false\)/);
  assert.match(src, /refreshCurrentUser/);
  assert.match(src, /handleRefreshProfile/);
  assert.match(src, /const mountedRef = useRef\(true\)/);
  assert.match(src, /mountedRef\.current = false/);
  assert.match(src, /refreshInFlightRef/);
  assert.match(src, /if \(refreshInFlightRef\.current\) return;/);
  assert.match(src, /setRefreshing\(true\)/);
  assert.match(src, /await refreshCurrentUser\(\{ force: true, isActive: \(\) => mountedRef\.current \}\)/);
  assert.match(src, /if \(mountedRef\.current\) setRefreshing\(false\)/);
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
