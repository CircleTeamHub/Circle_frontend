const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('ProfileScreen removes the credit score row and links profile commerce pages', () => {
  const src = read('src/features/profile/screens/ProfileScreen.tsx');

  assert.doesNotMatch(src, /profile\.creditScore/);
  assert.match(src, /profile\.systemAnnouncements/);
  assert.match(src, /profile\.memberCenter/);
  assert.match(src, /profile\.wallet/);
  assert.match(src, /profile\.mall/);
  assert.match(src, /profile\.collections/);
  assert.match(src, /profile\/member-center/);
  assert.match(src, /profile\/system-announcements/);
  assert.match(src, /profile\/wallet/);
  assert.match(src, /profile\/mall/);
  assert.match(src, /profile\/collections/);
});

test('ProfileScreen places system announcements before membership and settings after notes', () => {
  const src = read('src/features/profile/screens/ProfileScreen.tsx');
  const match = src.match(/const MENU_ITEM_KEYS:[\s\S]*?\[] = \[([\s\S]*?)\];/);

  assert.ok(match, 'MENU_ITEM_KEYS should exist');

  const ids = Array.from(
    match[1].matchAll(/id: MENU_ID\.([A-Z_]+)/g),
    ([, value]) => value,
  );

  assert.deepEqual(ids, [
    'SYSTEM_ANNOUNCEMENTS',
    'MEMBER_CENTER',
    'WALLET',
    'MALL',
    'COLLECTIONS',
    'NOTES',
    'APP_SETTINGS',
  ]);
});

test('profile commerce routes export their screens', () => {
  assert.match(read('app/(tabs)/profile/system-announcements.tsx'), /SystemAnnouncementsScreen/);
  assert.match(read('app/(tabs)/profile/member-center.tsx'), /MemberCenterScreen/);
  assert.match(read('app/(tabs)/profile/member-rules.tsx'), /MemberRulesScreen/);
  assert.match(read('app/(tabs)/profile/wallet.tsx'), /WalletScreen/);
  assert.match(read('app/(tabs)/profile/mall.tsx'), /MallScreen/);
  assert.match(read('app/(tabs)/profile/collections.tsx'), /CollectionsScreen/);
  assert.match(read('app/(tabs)/profile/app-settings.tsx'), /AppSettingsScreen/);
});

test('MemberCenterScreen shows VIP1 to VIP5 and links rules', () => {
  const src = read('src/features/profile/screens/MemberCenterScreen.tsx');
  const api = read('src/services/api/membership.ts');

  for (const level of [1, 2, 3, 4, 5]) {
    assert.match(src, new RegExp(`VIP${level}`));
  }

  assert.match(src, /fetchMembershipPlans/);
  assert.match(src, /upgradeMembership/);
  assert.match(api, /\/membership\/plans/);
  assert.match(api, /\/membership\/upgrade/);
  assert.match(src, /会员规则/);
  assert.match(src, /profile\/member-rules/);
});

test('WalletScreen shows remaining points and recharge packages', () => {
  const src = read('src/features/profile/screens/WalletScreen.tsx');
  const api = read('src/services/api/coin.ts');

  assert.match(src, /fetchWallet/);
  assert.match(src, /rechargePoints/);
  assert.match(api, /\/coin\/wallet/);
  assert.match(api, /\/coin\/recharge/);
  assert.match(src, /积分余额/);
  assert.doesNotMatch(src, /帮积分/);
  assert.match(src, /100/);
  assert.match(src, /300/);
  assert.match(src, /500/);
  assert.match(src, /1000/);
  assert.match(src, /2000/);
});

test('MallScreen shows requested product areas', () => {
  const src = read('src/features/profile/screens/MallScreen.tsx');
  const api = read('src/services/api/mall.ts');

  assert.match(src, /fetchMallSections/);
  assert.match(api, /\/mall\/sections/);
  assert.match(src, /群扩容/);
  assert.match(src, /靓号/);
  assert.match(src, /会员充值/);
  assert.match(src, /积分充值/);
});

test('CollectionsScreen shows collectible content types', () => {
  const src = read('src/features/profile/screens/CollectionsScreen.tsx');
  const api = read('src/services/api/collections.ts');

  assert.match(src, /horizontal/);
  assert.match(src, /fetchCollections/);
  assert.doesNotMatch(src, /createCollection/);
  assert.match(src, /deleteCollection/);
  assert.match(api, /\/collections/);
  assert.doesNotMatch(src, /flexWrap:\s*'wrap'/);
  assert.match(src, /聊天记录/);
  assert.match(src, /视频/);
  assert.match(src, /语音/);
  assert.match(src, /信息/);
  assert.match(src, /收藏笔记/);
  assert.match(src, /normalizeNoteCardPayload/);
  assert.match(src, /getCollectedOpenIMMessagePayload/);
  assert.match(src, /getNoteDetailHref\('profile'/);
  assert.match(src, /getChatDetailHref\(\s*'profile'/);
  assert.match(src, /getUserProfileHref\(\s*'profile'/);
  assert.match(src, /回到消息/);
  assert.match(src, /发送人/);
  assert.match(src, /来自/);
});
