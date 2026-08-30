const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

// ─── 载荷:常量单一事实源守护 ─────────────────────────────────────────────────

test('qr-payload inlined constants stay in sync with constants/branding', () => {
  // qr-payload 被 node --test 直测,按 .mts 惯例运行时零依赖 —— 常量是内联副本,
  // 这里锁住它与 branding.ts 不漂移:改任何一边,本测试都会红。
  const branding = read('src/constants/branding.ts');
  const payload = read('src/features/qr/qr-payload.ts');

  assert.match(
    branding,
    /APP_DEEP_LINK_SCHEMES = \['windnoteai', 'circleim'\] as const/,
  );
  assert.match(
    payload,
    /'windnoteai-preprod'/,
  );
  for (const host of ['windnote.ai', 'www.windnote.ai', 'circle.im', 'www.circle.im']) {
    assert.ok(branding.includes(`'${host}'`), `branding missing ${host}`);
    assert.ok(payload.includes(`'${host}'`), `qr-payload missing ${host}`);
  }
});

test('native QR surfaces emit the scheme for the installed app variant', () => {
  const runtimeScheme = read('src/features/qr/app-qr-scheme.ts');
  const qrScreen = read('src/features/qr/screens/QrCodeScreen.tsx');
  const qrBubble = read('src/features/chat/components/bubbles/qr-card-bubble.tsx');

  assert.match(runtimeScheme, /Constants\.expoConfig\?\.extra\?\.appVariant/);
  assert.match(runtimeScheme, /qrSchemeForAppVariant/);
  for (const source of [qrScreen, qrBubble]) {
    assert.match(source, /OUTBOUND_APP_QR_SCHEME/);
    assert.match(source, /buildQrUrl\([^)]*OUTBOUND_APP_QR_SCHEME\)/);
  }
});

// ─── 扫码器接线 ───────────────────────────────────────────────────────────────

test('scan result resolves app qr payloads into the /qr landing route first', () => {
  const source = read('src/features/messages/utils/scan-result.ts');
  assert.match(source, /parseQrLoginToken, parseQrToken/);
  const qrIndex = source.indexOf('parseQrToken(value)');
  const routeMapIndex = source.indexOf('normalizeMessagePath(value)', qrIndex);
  assert.ok(qrIndex > 0, 'scan-result must call parseQrToken');
  assert.ok(
    routeMapIndex > qrIndex,
    'qr token must take precedence over static route map',
  );
  assert.match(source, /pathname: '\/qr', params: \{ t: qrToken \}/);
});

test('login QR uses a distinct route that old clients cannot misread as a join QR', () => {
  const payload = read('src/features/qr/qr-payload.ts');
  const pane = read('src/features/auth/components/QrLoginPane.tsx');
  const resolver = read('src/features/messages/utils/scan-result.ts');

  assert.match(payload, /export function buildQrLoginUrl/);
  assert.match(payload, /qr-login\?t=/);
  assert.match(pane, /buildQrLoginUrl\(session\.qrToken\)/);
  assert.match(resolver, /pathname: '\/qr-login'/);
  assert.match(
    read('app/qr-login.tsx'),
    /QrLandingScreen/,
  );
});

// ─── 顶层路由与深链 ───────────────────────────────────────────────────────────

test('top-level /qr and /qr-code routes point at the qr feature screens', () => {
  assert.match(
    read('app/qr.tsx'),
    /export \{ default \} from '@\/features\/qr\/screens\/QrLandingScreen'/,
  );
  assert.match(
    read('app/qr-code.tsx'),
    /export \{ default \} from '@\/features\/qr\/screens\/QrCodeScreen'/,
  );
});

// ─── 展示页与落地页关键行为 ───────────────────────────────────────────────────

test('QrCodeScreen issues a server token and renders it as a deep link QR', () => {
  const source = read('src/features/qr/screens/QrCodeScreen.tsx');
  assert.match(source, /issueQrToken\(\{ type: TYPE_MAP\[routeType\], targetId \}\)/);
  assert.match(
    source,
    /buildQrUrl\(result\.token, OUTBOUND_APP_QR_SCHEME\)/,
  );
  assert.match(source, /saveQrPngToLibrary/);
  assert.match(source, /toDataURL/);
  // 群/圈码显示七天有效期,个人码显示长期有效。
  assert.match(source, /qr\.expiresBefore/);
  assert.match(source, /qr\.userValidity/);
});

test('personal QR can be rotated after confirmation without exposing the action elsewhere', () => {
  const api = read('src/services/api/qr.ts');
  const screen = read('src/features/qr/screens/QrCodeScreen.tsx');

  assert.match(api, /export function rotateUserQrToken/);
  assert.match(api, /'\/qr\/tokens\/rotate'/);
  assert.match(api, /method: 'POST'/);
  assert.match(api, /body: \{ type: 'USER' \}/);

  assert.match(screen, /rotateUserQrToken\(\)/);
  assert.match(screen, /routeType === 'user'/);
  assert.match(screen, /qr\.resetConfirmTitle/);
  assert.match(screen, /qr\.resetConfirmMessage/);
  assert.match(screen, /setQrToken\(result\.token\)/);
  assert.match(
    screen,
    /setQrValue\(buildQrUrl\(result\.token, OUTBOUND_APP_QR_SCHEME\)\)/,
  );
  assert.match(screen, /qr\.resetSuccessTitle/);
  assert.match(screen, /qr\.resetFailedTitle/);
});

test('QrLandingScreen previews before joining and never auto-joins', () => {
  const source = read('src/features/qr/screens/QrLandingScreen.tsx');
  assert.match(source, /resolveQrToken\(token\)/);
  // join 只能出现在用户按下主按钮的回调里(handlePrimary),不在 effect 里。
  const effectBlock = source.slice(
    source.indexOf('useEffect('),
    source.indexOf('const openConversation'),
  );
  assert.doesNotMatch(effectBlock, /joinByQrToken/);
  assert.match(source, /const handlePrimary = useCallback/);
  assert.match(source, /joinByQrToken\(token\)/);
  // 名片码走加好友申请页并透传 qrToken。
  assert.match(source, /getSendFriendRequestHref\('messages', preview\.targetId, preview\.name, \{\s*qrToken: token,\s*\}\)/);
  // 严格招新 PENDING 与直接入圈 JOINED 各有文案。
  assert.match(source, /qr\.circleJoinedTitle/);
  assert.match(source, /qr\.circlePendingTitle/);
});

// ─── 名片码 → 加好友申请透传链 ───────────────────────────────────────────────

test('friend request pipeline carries qrToken end to end', () => {
  const friendsApi = read('src/services/api/friends.ts');
  assert.match(friendsApi, /qrToken\?: string/);
  assert.match(friendsApi, /\.\.\.\(input\.qrToken \? \{ qrToken: input\.qrToken \} : \{\}\)/);

  const routes = read('src/features/user/utils/routes.ts');
  assert.match(routes, /opts\?\.qrToken \? \{ qrToken: opts\.qrToken \} : \{\}/);

  const requestScreen = read('src/features/social/screens/SendFriendRequestScreen.tsx');
  assert.match(requestScreen, /qrToken\?: string/);
  assert.match(
    requestScreen,
    /qrToken: typeof params\.qrToken === 'string' \? params\.qrToken : undefined/,
  );
});

// ─── 三处入口 ────────────────────────────────────────────────────────────────

test('chat info exposes a group QR row that forks standalone vs circle', () => {
  const source = read('src/features/chat/screens/ChatInfoScreen.tssx'.replace('tssx', 'tsx'));
  assert.match(source, /qr\.groupEntry/);
  assert.match(source, /const handleOpenGroupQr = useCallback/);
  assert.match(source, /params: \{ type: 'group', id, name: groupTitle \}/);
  assert.match(source, /params: \{ type: 'circle', id: groupID, name: groupTitle \}/);
  // 临时房不发码(有自己的邀请链接),入口在非临时分支里。
  assert.match(source, /isTempConversation \?[\s\S]{0,400}tempChats\.inviteLink[\s\S]{0,700}qr\.groupEntry/);
});

test('profile and add-friend screens expose my QR entries', () => {
  const profile = read('src/features/profile/screens/ProfileScreen.tsx');
  assert.match(profile, /handleOpenMyQr/);
  assert.match(profile, /params: \{ type: "user" \}/);
  assert.match(profile, /qr-code-outline/);

  const addFriend = read('src/features/social/screens/AddFriendScreen.tsx');
  assert.match(addFriend, /qr\.myQrEntry/);
  assert.match(addFriend, /handleOpenScan/);
  assert.match(addFriend, /\/\(tabs\)\/messages\/scan/);
});

// ─── 错误码与权限串 ──────────────────────────────────────────────────────────

test('new server error codes are registered and localized in all five locales', () => {
  const registry = read('src/services/api/server-error-codes.ts');
  const codes = [
    'QR_INVALID',
    'QR_EXPIRED',
    'QR_TYPE_UNSUPPORTED',
    'QR_ISSUE_FORBIDDEN',
    'CHAT_GROUP_FULL',
  ];
  for (const code of codes) {
    assert.ok(registry.includes(`'${code}'`), `registry missing ${code}`);
  }

  const locales = ['zh', 'en', 'ja', 'ko', 'es'];
  const qrKeySets = [];
  for (const lang of locales) {
    const data = JSON.parse(read(`src/i18n/locales/${lang}.json`));
    for (const code of codes) {
      assert.ok(data.serverErrors?.[code], `${lang} missing serverErrors.${code}`);
    }
    assert.ok(data.qr, `${lang} missing qr namespace`);
    for (const key of [
      'reset',
      'resetConfirmTitle',
      'resetConfirmMessage',
      'resetSuccessTitle',
      'resetSuccessMessage',
      'resetFailedTitle',
      'resetFailedMessage',
    ]) {
      assert.equal(typeof data.qr[key], 'string', `${lang} missing qr.${key}`);
    }
    qrKeySets.push(Object.keys(data.qr).sort().join(','));
  }
  // 五语言 qr 命名空间键集合完全一致。
  assert.equal(new Set(qrKeySets).size, 1, 'qr namespace keys diverge across locales');
});

test('photo library add permission and native deps are declared', () => {
  const appJson = JSON.parse(read('app.json'));
  assert.ok(
    appJson.expo.ios.infoPlist.NSPhotoLibraryAddUsageDescription,
    'NSPhotoLibraryAddUsageDescription must live in app.json infoPlist',
  );
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.dependencies['expo-media-library'], 'expo-media-library missing');
  assert.ok(pkg.dependencies['expo-file-system'], 'expo-file-system missing');
  assert.ok(pkg.dependencies['react-native-qrcode-svg'], 'qrcode-svg missing');
});
