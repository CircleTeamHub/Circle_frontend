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
  assert.match(read('app/(tabs)/profile/credit-score.tsx'), /CreditScoreScreen/);
  assert.match(read('app/(tabs)/profile/wallet.tsx'), /WalletScreen/);
  assert.match(read('app/(tabs)/profile/mall.tsx'), /MallScreen/);
  assert.match(read('app/(tabs)/profile/collections.tsx'), /CollectionsScreen/);
  assert.match(read('app/(tabs)/profile/app-settings.tsx'), /AppSettingsScreen/);
});

test('MemberCenterScreen renders the four-tier catalog without legacy commerce APIs', () => {
  const src = read('src/features/profile/screens/MemberCenterScreen.tsx');
  const catalog = read('src/features/profile/membership-plans.ts');

  for (const [tier, price] of [
    ['silver', 298],
    ['gold', 1288],
    ['diamond', 1998],
    ['super', 3998],
  ]) {
    assert.match(catalog, new RegExp(`tier: '${tier}'[\\s\\S]*?amount: ${price}`));
  }

  assert.match(src, /MEMBERSHIP_PLANS\.map/);
  assert.match(src, /MEMBERSHIP_BENEFITS\.map/);
  assert.doesNotMatch(src, /@\/services\/api\/membership/);
  assert.doesNotMatch(src, /fetchMembershipPlans|upgradeMembership|performMembershipUpgradeFlow/);
  assert.doesNotMatch(src, /积分|兑换会员|确认兑换/);
});

test('MemberCenterScreen provides horizontal selection, tier markers, and selected benefits', () => {
  const src = read('src/features/profile/screens/MemberCenterScreen.tsx');

  assert.match(src, /horizontal/);
  assert.match(src, /showsHorizontalScrollIndicator/);
  assert.match(src, /plan\.recommended/);
  assert.match(src, /defaultValue: '推荐'/);
  assert.match(src, /duration\.type === 'lifetime'/);
  assert.match(src, /defaultValue: '永久'/);
  assert.match(src, /benefit\.values\[selectedPlan\.tier\]/);
  assert.match(src, /defaultValue: '会员权益'/);
  assert.match(src, /profile\/member-rules/);
});

test('MemberCenterScreen routes configured support and otherwise shows a clear fallback', () => {
  const src = read('src/features/profile/screens/MemberCenterScreen.tsx');
  const env = read('.env.example');

  assert.match(src, /process\.env\.EXPO_PUBLIC_MEMBERSHIP_SUPPORT_USER_ID/);
  assert.match(src, /getUserProfileHref\(\s*'profile',\s*MEMBERSHIP_SUPPORT_USER_ID/);
  assert.match(src, /router\.push/);
  assert.match(src, /Alert\.alert/);
  assert.match(src, /defaultValue: '客服账号暂未配置'/);
  assert.match(src, /defaultValue: '请联系平台官方客服咨询会员开通或升级。'/);
  assert.match(env, /EXPO_PUBLIC_MEMBERSHIP_SUPPORT_USER_ID=/);
  assert.doesNotMatch(src, /微信|WeChat|支付宝|Alipay/);
});

test('MemberCenterScreen distinguishes activation, upgrade, current, and lower-tier contact states', () => {
  const src = read('src/features/profile/screens/MemberCenterScreen.tsx');

  assert.match(src, /selectedPlan\.level > currentPlanLevel/);
  assert.match(src, /selectedPlan\.level === currentPlanLevel/);
  assert.match(src, /contactToActivate/);
  assert.match(src, /defaultValue: '联系客服开通 {{plan}}'/);
  assert.match(src, /contactToUpgrade/);
  assert.match(src, /defaultValue: '联系客服升级至 {{plan}}'/);
  assert.match(src, /defaultValue: '当前已是 {{plan}}，联系客服咨询'/);
  assert.match(src, /defaultValue: '当前会员等级更高，联系客服咨询'/);
  assert.match(src, /defaultValue: '已开通会员可联系客服补差价升级/);
});

test('ProfileScreen displays effective four-tier membership labels', () => {
  const src = read('src/features/profile/screens/ProfileScreen.tsx');

  assert.match(src, /getMembershipTierForVipLevel/);
  assert.match(src, /getMembershipTierForVipLevel\(vipLevel\)/);
  assert.match(src, /defaultValue: '普通用户'/);
  assert.match(src, /super: ["']超级会员["']/);
  assert.doesNotMatch(src, />VIP \{vipLevel\}</);
});

test('CreditScoreScreen explains score status and change rules via i18n', () => {
  const src = read('src/features/profile/screens/CreditScoreScreen.tsx');

  assert.match(src, /useAuthStore/);
  assert.match(src, /creditScore/);
  // 文案走 i18n，不再硬编码中文（英文用户否则会看到中文）。
  assert.match(src, /useTranslation/);
  assert.match(src, /t\("credit\.title"\)/);
  assert.match(src, /credit\.tier\./);
  assert.match(src, /credit\.(improveRules|deductRules|impacts|recentRecords)/);
  assert.doesNotMatch(src, /信誉值详情/);

  // 两个语言包都必须提供 credit 段的关键 key，避免缺 key 露出裸键名。
  const zh = JSON.parse(read('src/i18n/locales/zh.json'));
  const en = JSON.parse(read('src/i18n/locales/en.json'));
  for (const bundle of [zh, en]) {
    assert.ok(bundle.credit?.title);
    assert.ok(bundle.credit?.tier?.excellent?.title);
    assert.ok(Array.isArray(bundle.credit?.improveRules));
    assert.ok(bundle.credit?.sections?.recent);
  }
  assert.equal(zh.credit.title, '信誉值详情');
});

test('WalletScreen shows the balance without an unsupported recharge action', () => {
  const src = read('src/features/profile/screens/WalletScreen.tsx');
  const api = read('src/services/api/coin.ts');

  assert.match(src, /fetchWallet/);
  assert.match(api, /\/coin\/wallet/);
  assert.doesNotMatch(src, /rechargePoints|RECHARGE_PACKAGES/);
  assert.doesNotMatch(api, /\/coin\/recharge/);
  assert.match(src, /purchaseUnavailable/);
  assert.match(src, /积分余额/);
  assert.doesNotMatch(src, /帮积分/);
});

test('MallScreen shows requested product areas', () => {
  const src = read('src/features/profile/screens/MallScreen.tsx');
  const api = read('src/services/api/mall.ts');
  // Backend sends title/name; the api module maps id → i18n key and keeps the backend
  // string as t()'s defaultValue. Runtime mapping is covered in mall-membership-mapping.test.js.
  const zh = read('src/i18n/locales/zh.json');

  assert.match(src, /fetchMallSections/);
  assert.match(api, /\/mall\/sections/);
  assert.match(zh, /群扩容/);
  assert.match(zh, /靓号/);
  assert.match(zh, /会员充值/);
  assert.match(zh, /积分充值/);
});

test('CollectionsScreen shows collectible content types', () => {
  const src = read('src/features/profile/screens/CollectionsScreen.tsx');
  const api = read('src/services/api/collections.ts');
  // Content-type labels and row copy are i18n'd (COLLECTION_TYPES holds labelKeys); the
  // Chinese display strings now live in the locale bundle rather than the component.
  const zh = read('src/i18n/locales/zh.json');

  assert.match(src, /horizontal/);
  assert.match(src, /fetchCollections/);
  assert.doesNotMatch(src, /createCollection/);
  assert.match(src, /deleteCollection/);
  assert.match(api, /\/collections/);
  assert.doesNotMatch(src, /flexWrap:\s*'wrap'/);
  assert.match(zh, /聊天记录/);
  assert.match(zh, /视频/);
  assert.match(zh, /语音/);
  assert.match(zh, /信息/);
  assert.match(src, /getCollectedOpenIMMessagePayload/);
  assert.match(src, /getChatDetailHref\(\s*'profile'/);
  assert.match(src, /getUserProfileHref\(\s*'profile'/);
  assert.match(zh, /回到消息/);
  assert.match(zh, /发送人/);
  assert.match(zh, /来自/);
});

test('CollectionsScreen no longer lists NOTE collections (notes go to My Notes)', () => {
  const src = read('src/features/profile/screens/CollectionsScreen.tsx');

  // 收藏笔记已改为 collectNote 直接复制进「我的笔记」：
  // 收藏页不再有 NOTE 标签页，也过滤掉历史遗留的 NOTE 收藏项。
  assert.doesNotMatch(src, /profile\.collections\.tabs\.note/);
  assert.doesNotMatch(src, /normalizeNoteCardPayload/);
  assert.doesNotMatch(src, /getNoteDetailHref/);
  assert.match(src, /Exclude<CollectionType, 'NOTE'>/);
  assert.match(src, /item\.type !== 'NOTE'/);
});
