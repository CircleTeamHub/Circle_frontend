const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

// Android 11+ 的包可见性要求 manifest 里声明 geo: 的 <queries>，否则装了地图 app
// 也探测不到；iOS 的 maps: 同样受 LSApplicationQueriesSchemes 限制。两个清单里
// 都没有相应声明，所以 canOpenURL 探测的结果必然是「不支持」→ 永远退到浏览器。
test('location bubbles open the native map directly instead of probing support', () => {
  const bubble = read('src/features/chat/components/bubbles/location-card.tsx');
  const appJson = read('app.json');

  assert.doesNotMatch(bubble, /Linking\.canOpenURL/);
  assert.match(bubble, /await Linking\.openURL\(primary\)/);
  assert.match(bubble, /urls\.fallback/);
  // 探测被删掉的前提：清单里确实没有声明可见性。哪天补了声明，这条会提醒重新评估。
  assert.doesNotMatch(appJson, /LSApplicationQueriesSchemes/);
  assert.doesNotMatch(appJson, /"queries"/);
});

// 后端可能因为一个前端当前隐藏的门槛（靓号）判定不可报名，这时 requirements 是
// 空串，原来会弹出「报名需满足：」后面什么都没有。
test('signup blocking keeps an explanation when no visible requirement is left', () => {
  const card = read('src/features/discover/components/plaza-post-card.tsx');

  assert.match(card, /const requirements = buildSignupReasonText\(\)/);
  assert.match(card, /requirements\s*\?[\s\S]{0,240}signupBlockedGeneric/);
  // 看主页那条路是**另一段**代码，同样的门槛、同样的空串问题；两处都走同一个
  // helper，免得下次只修一边。
  assert.match(card, /requirements\s*\?[\s\S]{0,240}profileBlockedGeneric/);
  assert.equal(
    (card.match(/buildRestrictionReasonText\(/g) ?? []).length,
    2,
    '报名与看主页都必须走共享 helper',
  );
  assert.doesNotMatch(card, /reasons\.push\(/);
  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const messages = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    assert.ok(messages.plaza.signupBlockedGeneric, `${locale} 缺 signupBlockedGeneric`);
    assert.ok(messages.plaza.profileBlockedGeneric, `${locale} 缺 profileBlockedGeneric`);
  }
});

// 从选点页回来时位置已经被 focus effect 消费掉了。发送位被占着就直接 return，
// 用户选的点既不发也不报错，彻底丢失。
test('a picked location survives an in-flight send instead of vanishing', () => {
  const screen = read('src/features/chat/screens/ChatDetailScreen.tsx');

  assert.match(screen, /const slotFree = await waitForSendSlot\(\{/);
  assert.match(screen, /isBusy: \(\) => inFlightRef\.current/);
  assert.match(screen, /isMounted: \(\) => mountedRef\.current/);
  // 等不到也要显式报错，不能换一种静默丢弃。
  assert.match(screen, /if \(!slotFree\) \{[\s\S]{0,240}locationSendFailed/);
});

// discoverUnread = 铃铛中心「互动」列表的未读数。发现页把它画成朋友圈那一行的
// 红点，那这条路必须能走到真正能看到并清掉它的地方（互动是铃铛中心的默认 tab）。
test('the moments screen reaches the interaction notifications its badge counts', () => {
  const moments = read('src/features/discover/screens/MomentsScreen.tsx');
  const discover = read('src/features/discover/screens/DiscoverScreen.tsx');

  assert.match(moments, /discoverUnread/);
  assert.match(moments, /\(tabs\)\/discover\/notification-center/);
  assert.match(moments, /<Badge count=\{interactionUnread\}/);
  // 发现页那一行的红点仍然读同一个计数，两边不能漂移。
  assert.match(discover, /momentsUnread = useTabBadgeStore\(\(state\) => state\.discoverUnread\)/);
});

// 筛选条件在广场页设置、全局生效。「我的圈子」面板挂在圈子管理 / 我的圈子下，
// 那两个页面都没有筛选入口，不给提示就是静默隐藏条目且无处可清。
test('my-circles surfaces and can clear an active plaza filter', () => {
  const panel = read('src/features/discover/components/my-circles-panel.tsx');
  const store = read('src/features/discover/store/use-discover-filter-store.ts');

  assert.match(panel, /const filterActive =/);
  assert.match(panel, /discover\.filter\.activeInMyCircles/);
  assert.match(panel, /onPress=\{clearAppliedFilter\}/);
  assert.match(store, /clearAppliedFilter: \(\) =>/);
  assert.match(store, /appliedCircleIds: \[\][\s\S]{0,200}draftCircleIds: \[\]/);
  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const messages = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    assert.ok(
      messages.discover.filter.activeInMyCircles,
      `${locale} 缺 activeInMyCircles`,
    );
  }
});

// 选点页本身支持搜索和手动拖动，定位权限只用来预置地图中心。拒权/取点失败都
// 不该把「分享公共地点」整件事堵死。
test('the location picker opens even without device location', () => {
  const screen = read('src/features/chat/screens/ChatDetailScreen.tsx');

  assert.match(screen, /const openPickerAt = \(params\?: Record<string, string>\) =>/);
  assert.match(
    screen,
    /if \(!permission\.granted\) \{\s*\n\s*openPickerAt\(\);\s*\n\s*return;/,
  );
  // 取当前位置失败也照常开图。
  assert.match(screen, /\} catch \{\s*\n\s*\/\/[^\n]*\n\s*openPickerAt\(\);/);
  // 只看定位这一处：录音 / 相册 / 相机拒权仍然照旧弹提示，那几条不该被这个改动带走。
  assert.doesNotMatch(
    screen,
    /Location\.requestForegroundPermissionsAsync\(\);[\s\S]{0,160}Alert\.alert/,
  );
  assert.match(
    screen,
    /requestRecordingPermissionsAsync\(\);[\s\S]{0,120}Alert\.alert/,
  );
});

// 先点 A 后点 B、A 的反查后到，B 的坐标会配上 A 的地址；搜索结果更狠，会把整个
// 选点挪回旧位置。
test('the map picker discards superseded geocoding responses', () => {
  const picker = read('src/features/location/components/map-location-picker-screen.tsx');

  assert.match(picker, /let pickGeneration = 0;/);
  // 反查和搜索都必须先领号，再在写回前比对。
  assert.equal(
    (picker.match(/pickGeneration \+= 1;/g) ?? []).length,
    2,
    'reverseGeocode 和 searchPlace 都要领号',
  );
  assert.equal(
    (picker.match(/if \(generation !== pickGeneration\) return;/g) ?? []).length,
    2,
    '两条异步路径都要在写回前比对',
  );
});

// CDN 拿不到 leaflet 时 L 是 undefined，初始化第一行就抛，确认按钮的监听根本没
// 注册上，而 onLoadEnd 已经把转圈收掉了 —— 用户看到一个「能点但没反应」的界面。
test('the map picker reports a missing map runtime instead of going inert', () => {
  const picker = read('src/features/location/components/map-location-picker-screen.tsx');

  assert.match(picker, /if \(typeof L === 'undefined'\) \{\s*\n\s*post\(\{ type: 'map-runtime-unavailable' \}\);/);
  assert.match(picker, /payload\.type === 'map-runtime-unavailable'/);
  assert.match(picker, /setMapUnavailable\(true\)/);
  assert.match(picker, /setWebViewKey\(\(key\) => key \+ 1\)/);
  assert.match(picker, /labels\.retryButton/);
  assert.match(picker, /labels\.unavailableMessage/);
  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const messages = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    assert.ok(messages.location.mapUnavailable, `${locale} 缺 location.mapUnavailable`);
  }
});

// 后端只暴露 vipLevel，每日会员和月度白银是同一档 silver/level 1。按方案 id 比
// 的话，客服开通一天会员后会把「月度」标成当前、「每日」反而没标。
test('the membership badge marks the current tier, not one duration of it', () => {
  const screen = read('src/features/profile/screens/MemberCenterScreen.tsx');
  const plans = read('src/features/profile/membership-plans.ts');

  assert.match(screen, /const isCurrentTier = plan\.tier === currentTier;/);
  assert.doesNotMatch(screen, /const isCurrentTier = plan\.id === currentTier;/);
  // 前提：daily 与 silver 共用一个 tier/level，无法从 vipLevel 区分。
  assert.match(plans, /id: 'daily',[\s\S]{0,200}tier: 'silver',\s*\n\s*level: 1,/);
});

// 选点 store 是全局的，而 ChatDetailScreen 一获得焦点就消费它并直接把位置发出去。
// 不绑会话的话，深链直接进选点页、或者确认之后被推送带去另一个会话，这条位置
// 就会发给非预期的收件人。
test('picked locations are scoped to the conversation that opened the picker', () => {
  const store = read('src/features/chat/store/use-chat-location-picker-store.ts');
  const chat = read('src/features/chat/screens/ChatDetailScreen.tsx');
  const picker = read('src/features/chat/screens/ChatLocationPickerScreen.tsx');

  assert.match(store, /consumePickedLocation: \(conversationID\) =>/);
  assert.match(store, /if \(pending\.conversationID !== conversationID\) return null;/);
  // 对不上的结果必须就地丢弃，不能留在 store 里等下一个会话。
  assert.match(store, /set\(\{ pending: null \}\);\s*\n\s*if \(pending\.conversationID/);

  assert.match(chat, /params: \{ \.\.\.params, conversationID \}/);
  assert.match(chat, /const picked = consumePickedLocation\(conversationID\);/);
  assert.match(picker, /useLocalSearchParams<\{ conversationID\?: string \}>/);
});
