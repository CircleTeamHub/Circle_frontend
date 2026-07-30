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

test('ProfileScreen places system announcements first, customer service after notes, settings last', () => {
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
    'CUSTOMER_SERVICE',
    'APP_SETTINGS',
  ]);
});

test('ProfileScreen customer service row routes to the support-center screen', () => {
  const src = read('src/features/profile/screens/ProfileScreen.tsx');

  assert.match(src, /id: MENU_ID\.CUSTOMER_SERVICE[\s\S]*?icon: "headset-outline"/);
  assert.match(src, /profile\.customerService\.menuLabel/);
  assert.match(
    src,
    /\[MENU_ID\.CUSTOMER_SERVICE\]:\s*["']\/\(tabs\)\/profile\/customer-service["']/,
  );
});

test('customer service exposes recharge/issue/dispute/account with env override + SUPPORT_ACCOUNT_ID fallback', () => {
  const cats = read('src/features/profile/support-categories.ts');
  const cfg = read('src/constants/config.ts');
  const screen = read('src/features/profile/screens/CustomerServiceScreen.tsx');

  const ids = Array.from(cats.matchAll(/id:\s*'([a-z]+)'/g), ([, v]) => v);
  assert.deepEqual(ids, ['recharge', 'issue', 'dispute', 'account']);
  assert.match(cats, /raw\?\.trim\(\)\s*\|\|\s*SUPPORT_ACCOUNT_ID/);

  assert.match(cfg, /export const SUPPORT_ACCOUNT_ID\s*=/);
  assert.match(cfg, /\|\|\s*['"]imAdmin['"]/);

  // Each category opens a 1:1 chat with its own account, titled by the category label.
  assert.match(screen, /getOrCreateSingleConversation\(\s*category\.accountId/);
  assert.match(screen, /getChatDetailHref\(\s*['"]profile['"],\s*category\.accountId/);

  // 会话解析较慢时用户可能已离场：解析/兜底完成后先查焦点守卫再跳转，
  // 避免从非活跃屏幕把聊天页推入栈。
  assert.match(screen, /useFocusEffect/);
  // 用单调 focus 代次守卫（而非会在重新聚焦后重置的布尔），挡住「离开→回来」期间的迟到解析。
  assert.match(screen, /focusGenerationRef/);
  assert.match(screen, /if \(isStale\(\)\) return;/);
  assert.doesNotMatch(screen, /focusedRef/);
  // 失焦(离场)的 cleanup 也 bump 代次:挡住「离开后不再回来」而解析刚好在离开后 resolve
  // 时的误跳转(否则代次没变、isStale 仍为 false)。
  assert.match(
    screen,
    /return \(\) => \{[\s\S]*?focusGenerationRef\.current \+= 1;[\s\S]*?\};/,
  );

  // 失败弹窗不再把原始 SDK/OpenIM 错误文案(可能含未本地化实现细节)展示给用户;
  // 改通用本地化提示 + reportError 上报结构化上下文。
  assert.match(screen, /reportError\(/);
  assert.doesNotMatch(screen, /error instanceof Error \? error\.message/);
});

test('profile commerce routes export their screens', () => {
  assert.match(read('app/(tabs)/profile/system-announcements.tsx'), /SystemAnnouncementsScreen/);
  assert.match(read('app/(tabs)/profile/member-center.tsx'), /MemberCenterScreen/);
  assert.match(read('app/(tabs)/profile/member-rules.tsx'), /MemberRulesScreen/);
  assert.match(read('app/(tabs)/profile/credit-score.tsx'), /CreditScoreScreen/);
  assert.match(read('app/(tabs)/profile/wallet.tsx'), /WalletScreen/);
  assert.match(read('app/(tabs)/profile/mall.tsx'), /MallScreen/);
  assert.match(read('app/(tabs)/profile/fancy-number.tsx'), /FancyNumberScreen/);
  assert.match(read('app/(tabs)/profile/group-expansion.tsx'), /GroupExpansionScreen/);
  assert.match(read('app/(tabs)/profile/collections.tsx'), /CollectionsScreen/);
  assert.match(read('app/(tabs)/profile/customer-service.tsx'), /CustomerServiceScreen/);
  assert.match(read('app/(tabs)/profile/app-settings.tsx'), /AppSettingsScreen/);
});

test('MallScreen routes fancy-number purchase and renewal actions', () => {
  const src = read('src/features/profile/screens/MallScreen.tsx');

  assert.match(src, /product\.action === 'fancy-number'[\s\S]*?profile\/fancy-number/);
  assert.match(src, /product\.action === 'fancy-number-renew'[\s\S]*?mode:\s*'renew'/);
  assert.match(src, /product\.action === 'group-expansion'[\s\S]*?profile\/group-expansion/);
});

test('GroupExpansionScreen loads owner circles and supports idempotent point purchases', () => {
  const src = read('src/features/profile/screens/GroupExpansionScreen.tsx');

  assert.match(src, /fetchMyCircles\(['"]created['"]\)/);
  assert.match(src, /fetchGroupExpansionProducts/);
  assert.match(src, /purchaseGroupExpansion/);
  assert.match(src, /generateIdempotencyKey/);
  assert.match(src, /setRealtimeBalance/);
  assert.match(src, /product\.purchasable/);
  assert.match(src, /isOffline/);
  assert.match(src, /GroupExpansionCirclePickerSheet/);
  assert.match(src, /setCirclePickerVisible\(true\)/);
  assert.match(src, /selectedCircle\.memberCount/);
  assert.doesNotMatch(src, /circles\.map/);
});

test('group expansion circle picker uses a searchable virtualized bottom-sheet list', () => {
  const rel =
    'src/features/profile/components/group-expansion-circle-picker-sheet.tsx';

  assert.ok(
    fs.existsSync(path.join(__dirname, '..', rel)),
    'group expansion circle picker sheet should exist',
  );
  const src = read(rel);

  assert.match(src, /BottomSheetModal/);
  assert.match(src, /FlatList/);
  assert.match(src, /TextInput/);
  assert.match(src, /circle\.name\.toLocaleLowerCase/);
  assert.match(src, /keyboardShouldPersistTaps=["']handled["']/);
  assert.match(src, /height:\s*['"]90%['"]/);
  assert.doesNotMatch(src, /maxHeight:\s*['"]82%['"]/);
  assert.match(src, /onSelect\(item\.id\)/);
  assert.match(src, /onClose\(\)/);
});

test('FancyNumberScreen supports listing, purchase, renewal, permanent switching, and account refresh', () => {
  const src = read('src/features/profile/screens/FancyNumberScreen.tsx');

  assert.match(src, /fetchFancyNumbers/);
  assert.match(src, /fetchMyFancyNumber/);
  assert.match(src, /renewFancyNumber/);
  assert.match(src, /checkFancyNumberAvailability/);
  assert.match(src, /purchaseCustomFancyNumber/);
  assert.match(src, /switchPermanentToCustomFancyNumber/);
  assert.match(src, /purchaseFancyNumber/);
  assert.match(src, /switchPermanentFancyNumber/);
  assert.match(src, /selectedRecommendation/);
  assert.match(
    src,
    /selectedRecommendation\?\.id[\s\S]*?purchaseFancyNumber/,
  );
  assert.match(
    src,
    /selectedRecommendation\?\.id[\s\S]*?switchPermanentFancyNumber/,
  );
  assert.match(
    src,
    /result\.accountId !== selectedRecommendation\.value/,
  );
  assert.match(src, /result\.accountId !== mine\.accountId/);
  assert.match(src, /TextInput/);
  assert.match(src, /setTimeout/);
  assert.match(src, /350/);
  assert.match(src, /mine\?\.permanent/);
  assert.match(src, /confirmSwitch/);
  assert.match(src, /generateIdempotencyKey/);
  assert.match(src, /setRealtimeBalance/);
  assert.match(src, /fetchCurrentUser/);
  assert.match(src, /purchaseMode === ["']PERMANENT_FREE["']/);
});

test('FancyNumberScreen fences load-more results by focus generation and cursor', () => {
  const src = read('src/features/profile/screens/FancyNumberScreen.tsx');

  assert.match(src, /catalogCursorRef/);
  assert.match(src, /focusGenerationRef\.current !== generation/);
  assert.match(src, /catalogCursorRef\.current !== cursor/);
});

test('ProfileScreen shows a red dot on system announcements when profile notifications are unread', () => {
  const src = read('src/features/profile/screens/ProfileScreen.tsx');

  assert.match(src, /useTabBadgeStore/);
  assert.match(src, /profileUnread/);
  assert.match(src, /item\.id === MENU_ID\.SYSTEM_ANNOUNCEMENTS/);
  assert.match(src, /showIndicatorDot=\{/);
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
  // 允许 staged rollout 的 fetchMembershipProgramStatus（会员中心正文是否放开的灰度开关，
  // 与 MemberCenterScreen.spec.tsx 的行为契约一致），但仍禁止旧的「积分兑换/直购升级」商业化 API。
  assert.doesNotMatch(src, /fetchMembershipPlans|upgradeMembership|performMembershipUpgradeFlow/);
  assert.doesNotMatch(src, /积分|兑换会员|确认兑换/);
});

test('MemberCenterScreen provides a vertical four-tier selection with per-tier visuals, markers, and selected benefits', () => {
  const src = read('src/features/profile/screens/MemberCenterScreen.tsx');
  const catalog = read('src/features/profile/membership-plans.ts');

  // 四档纵向全展示（tierStack，不再横滑把钻石/超级截在屏外），每档一套「贵金属」视觉。
  assert.match(src, /tierStack/);
  assert.match(src, /TIER_VISUALS/);
  assert.match(src, /accessibilityState=\{\{ selected \}\}/);
  assert.match(src, /plan\.recommended/);
  assert.match(src, /defaultValue: '推荐'/);
  assert.match(src, /duration\.type === 'lifetime'/);
  assert.match(src, /defaultValue: '永久'/);
  assert.match(src, /benefit\.values\[selectedPlan\.tier\]/);
  assert.match(src, /defaultValue: '会员权益'/);
  assert.match(src, /profile\/member-rules/);
  assert.match(src, /flexWrap:\s*'wrap'/);
  assert.match(src, /flexShrink:\s*1/);
  assert.match(src, /numberOfLines=\{2\}/);
  assert.doesNotMatch(src, /created-groups|premium-circle|silver-circle|gold-circle|diamond-circle|super-member-circle/);
  assert.doesNotMatch(catalog, /created-groups|premium-circle|silver-circle|gold-circle|diamond-circle|super-member-circle/);
});

test('MemberCenterScreen routes configured support and otherwise shows a clear fallback', () => {
  const src = read('src/features/profile/screens/MemberCenterScreen.tsx');
  const env = read('.env.example');

  assert.match(src, /process\.env\.EXPO_PUBLIC_MEMBERSHIP_SUPPORT_USER_ID/);
  assert.match(src, /getUserProfileHref\([\s\S]*'profile',[\s\S]*membershipSupportUserId/);
  assert.match(src, /router\.push/);
  assert.match(src, /Alert\.alert/);
  assert.match(src, /defaultValue: '客服账号暂未配置'/);
  assert.match(src, /defaultValue: '请联系平台官方客服咨询会员开通或升级。'/);
  assert.match(env, /EXPO_PUBLIC_MEMBERSHIP_SUPPORT_USER_ID=/);
  assert.doesNotMatch(src, /微信|WeChat|支付宝|Alipay/);
});

test('MemberCenterScreen refreshes the owning account on focus without stale overwrite', () => {
  const src = read('src/features/profile/screens/MemberCenterScreen.tsx');

  assert.match(src, /useFocusEffect/);
  assert.match(src, /fetchCurrentUser/);
  assert.match(src, /sessionEpoch/);
  assert.match(src, /useAuthStore\.getState\(\)/);
  assert.match(src, /active = false/);
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

test('MemberRulesScreen and every locale use the four-tier support-assisted contract', () => {
  const rules = read('src/features/profile/screens/MemberRulesScreen.tsx');
  const locales = ['zh', 'en', 'ja', 'ko', 'es'];
  const requiredMembershipKeys = [
    'regularUser',
    'currentIdentity',
    'catalogHint',
    'chooseTier',
    'recommended',
    'lifetime',
    'selected',
    'benefitsTitle',
    'contactToActivate',
    'contactToUpgrade',
    'contactForCurrent',
    'contactForLowerTier',
    'upgradeDifferenceNote',
    'supportUnavailableTitle',
    'supportUnavailableMessage',
  ];
  const requiredRuleKeys = [
    'catalog',
    'supportActivation',
    'upgrade',
    'expiry',
    'fairUse',
    'voiceToText',
    'excludedVisualBenefits',
  ];

  assert.match(rules, /profile\.memberRules\.rules\.catalog/);
  assert.match(rules, /profile\.memberRules\.rules\.voiceToText/);
  assert.doesNotMatch(rules, /levels|highTier|consume|irreversible/);
  assert.match(rules, /不在 App 内使用积分兑换或直接购买/);
  assert.doesNotMatch(rules, /VIP1-5|微信|WeChat|支付宝|Alipay/);
  assert.doesNotMatch(
    rules,
    /创建群.*上限|created.{0,8}(?:group|circle).{0,8}(?:count|limit)|高级圈子|premium.{0,8}circle|priority.{0,8}(?:support|customer service)|优先客服/i,
  );

  for (const locale of locales) {
    const bundle = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    const membership = bundle.profile?.membership;
    const memberRules = bundle.profile?.memberRules;

    for (const key of requiredMembershipKeys) assert.ok(membership?.[key], `${locale}: ${key}`);
    for (const tier of ['silver', 'gold', 'diamond', 'super']) {
      assert.ok(membership?.tiers?.[tier]?.name, `${locale}: tier ${tier}`);
    }
    for (const key of requiredRuleKeys) assert.ok(memberRules?.rules?.[key], `${locale}: rule ${key}`);
    for (const obsolete of [
      'confirmExchange',
      'activateVip',
      'currentLevel',
      'exchange',
      'confirmExchangeMessage',
      'confirmExchangePlan',
      'selectHigher',
    ]) {
      assert.equal(membership?.[obsolete], undefined, `${locale}: obsolete ${obsolete}`);
    }
    assert.equal(membership?.benefits?.createdGroups, undefined, `${locale}: createdGroups`);
    assert.equal(membership?.benefits?.premiumCircle, undefined, `${locale}: premiumCircle`);
    for (const removedValue of [
      'created-groups',
      'silver-circle',
      'gold-circle',
      'diamond-circle',
      'super-member-circle',
    ]) {
      assert.equal(
        membership?.benefitValues?.[removedValue],
        undefined,
        `${locale}: ${removedValue}`,
      );
    }

    const activeMembershipCopy = JSON.stringify({ membership, memberRules });
    assert.doesNotMatch(
      activeMembershipCopy,
      /priority customer service|priority support|优先客服|優先.{0,8}(?:サポート|カスタマー)|우선.{0,8}고객|atención prioritaria/i,
      `${locale}: customer service must remain a contact channel, not a paid benefit`,
    );
  }
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

test('MallScreen shows the remaining product areas without membership or points sections', () => {
  const src = read('src/features/profile/screens/MallScreen.tsx');
  const api = read('src/services/api/mall.ts');
  // Backend sends title/name; the api module maps id → i18n key and keeps the backend
  // string as t()'s defaultValue. Runtime mapping is covered in mall-membership-mapping.test.js.
  const zh = read('src/i18n/locales/zh.json');

  assert.match(src, /fetchMallSections/);
  assert.match(api, /\/mall\/sections/);
  assert.match(zh, /群扩容/);
  assert.match(zh, /靓号/);
  assert.match(zh, /装扮专区/);
  assert.doesNotMatch(api, /defaultTitle: '会员专区'/);
  assert.doesNotMatch(api, /defaultTitle: '积分专区'/);
});

test('MallScreen uses 商城 as the page title', () => {
  const src = read('src/features/profile/screens/MallScreen.tsx');
  const zh = read('src/i18n/locales/zh.json');

  assert.match(src, /profile\.mall\.title[\s\S]*?defaultValue: '商城'/);
  assert.match(zh, /"mall":\s*\{[\s\S]*?"title": "商城"/);
  assert.doesNotMatch(src, /管家商城/);
  assert.doesNotMatch(zh, /管家商城/);
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

test('MemberCenterScreen bounds retries and exits the initial loading state on failure', () => {
  const src = read('src/features/profile/screens/MemberCenterScreen.tsx');
  const store = read('src/stores/membershipProgramStore.ts');

  assert.match(store, /retry\(\(\) => fetchMembershipProgramStatus\(\)\)/);
  assert.match(store, /return previousStatus/);
  assert.match(
    src,
    /programStatus\?\.enabled \?\? \(programError \? false : null\)/,
  );
});
