/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('realtime client routes websocket badge events into the unified tab badge store', () => {
  const client = read('src/realtime/client.ts');

  assert.match(client, /REALTIME_WS_URL/);
  assert.match(client, /new WebSocket/);
  assert.match(client, /badge\.snapshot/);
  assert.match(client, /friend\.activity\.unread\.changed/);
  assert.match(client, /circle\.signup\.unread\.changed/);
  assert.match(client, /notification\.created/);
  assert.match(client, /applySnapshot/);
  assert.match(client, /setContactsUnread/);
  assert.match(client, /setDiscoverUnread/);
  assert.match(client, /setSignupUnread/);
  assert.match(client, /enqueueNotification/);
  assert.match(client, /setRealtimeConnected/);
});

test('realtime client authenticates with a message frame, never via the URL', () => {
  const client = read('src/realtime/client.ts');

  // 网关只认 {type:'auth',token} 消息帧；URL 带 token 会泄漏进日志且不被读取。
  assert.match(
    client,
    /onopen[\s\S]*?send\(JSON\.stringify\(\{ type: 'auth', token: normalizedToken \}\)\)/,
  );
  assert.doesNotMatch(client, /[?&]token=/);
  assert.doesNotMatch(client, /encodeURIComponent\(token\)/);
  assert.match(client, /new WebSocket\(REALTIME_WS_URL\)/);
});

test('realtime notification.created only prepends bell types but banners everything non-system', () => {
  const client = read('src/realtime/client.ts');

  // 铃铛列表类型白名单镜像后端 DISCOVER_NOTIFICATION_TYPES，须含全部互动类型。
  assert.match(client, /BELL_NOTIFICATION_TYPES/);
  for (const type of [
    'TRACE_LIKE',
    'TRACE_COMMENT',
    'COMMENT_REPLY',
    'CIRCLE_VERIFICATION_REQUESTED',
    'CIRCLE_INVITATION_APPROVED',
    'CIRCLE_INVITATION_REJECTED',
    'CIRCLE_ADMIN_OVERRIDE_APPROVED',
    'CIRCLE_POST_SIGNUP_CREATED',
    'CIRCLE_POST_AUTO_ENDED',
    'PROFILE_LIKE',
  ]) {
    assert.match(client, new RegExp(`'${type}'`));
  }
  // 好友申请不进铃铛列表（专属「新的朋友」收件箱），横幅不受影响。
  assert.doesNotMatch(client, /'FRIEND_REQUEST_RECEIVED'/);
  // prepend 受白名单门控；横幅入队在铃铛门外执行（圈子类另受「圈子通知设置」门控，见下）。
  assert.match(
    client,
    /if \(BELL_NOTIFICATION_TYPES\.has\(payload\.type\)\) \{[\s\S]*?setInteractive\(/,
  );
  assert.match(
    client,
    /\}\s*\n\s*useNotificationSnackbarStore\.getState\(\)\.enqueueNotification\(payload\);/,
  );
});

test('realtime gates circle-notification banners on the circle notification settings', () => {
  const client = read('src/realtime/client.ts');

  // 圈子通知（CIRCLE_*）的横幅受「圈子通知设置」控制：总开关或「通知提醒」关闭时
  // 不弹横幅（但铃铛/红点仍在门前处理，通知本身不丢）。
  assert.match(client, /useCircleNotificationStore/);
  assert.match(client, /payload\.type\.startsWith\('CIRCLE_'\)/);
  assert.match(client, /!inAppEnabled \|\| !bannerEnabled/);
  // 门控发生在铃铛 setInteractive 之后、横幅 enqueueNotification 之前。
  assert.match(
    client,
    /startsWith\('CIRCLE_'\)[\s\S]*?return;[\s\S]*?enqueueNotification\(payload\)/,
  );
});

test('circle notification preferences only promise in-app presentation control', () => {
  const store = read('src/features/discover/store/use-circle-notification-store.ts');
  const settings = read('src/features/discover/screens/CircleNotificationSettingsScreen.tsx');
  const profileSettings = read('src/features/profile/screens/NotificationSettingsScreen.tsx');
  const client = read('src/realtime/client.ts');
  const locales = [
    { data: JSON.parse(read('src/i18n/locales/en.json')), unsupported: /offline|push|all notifications/i },
    { data: JSON.parse(read('src/i18n/locales/zh.json')), unsupported: /离线|推送|所有通知/i },
    { data: JSON.parse(read('src/i18n/locales/es.json')), unsupported: /sin conexión|todas las notificaciones/i },
    { data: JSON.parse(read('src/i18n/locales/ja.json')), unsupported: /オフライン|すべての通知/i },
    { data: JSON.parse(read('src/i18n/locales/ko.json')), unsupported: /오프라인|모든 알림/i },
  ];

  assert.equal(store.includes('offlineEnabled'), false);
  assert.match(store, /version:\s*1/);
  assert.match(store, /partialize:[\s\S]*?inAppEnabled:[\s\S]*?bannerEnabled:/);
  assert.match(store, /migrate:/);
  assert.equal(settings.includes('notifications.offline'), false);
  assert.equal(profileSettings.includes('offlineReminder'), false);
  for (const { data: locale, unsupported } of locales) {
    const copy = JSON.stringify({
      discover: locale.discover.notifications,
      profileGlobal: locale.settingsDetails.notifications.circleGlobalHint,
      profileBanner: locale.settingsDetails.notifications.circleBannerHint,
    });
    assert.doesNotMatch(copy, unsupported);
  }
  assert.match(client, /const \{ inAppEnabled, bannerEnabled \}/);
  assert.match(client, /!inAppEnabled \|\| !bannerEnabled/);
});

test('app settings search omits the removed circle offline preference', () => {
  const appSettings = read('src/features/profile/screens/AppSettingsScreen.tsx');
  assert.equal(appSettings.includes("'offlineReminder'"), false);
});

test('discover bell badge reads the interactive unread count, not systemUnread', () => {
  const screen = read('src/features/discover/screens/DiscoverScreen.tsx');

  // 铃铛红点必须由 interaction.unread.changed 驱动的 discoverUnread 供数。
  assert.match(screen, /useTabBadgeStore\(\(state\) => state\.discoverUnread\)/);
  assert.doesNotMatch(screen, /useTabBadgeStore\(\(state\) => state\.systemUnread\)/);
  assert.match(screen, /Badge count=\{bellUnread\}/);
});

test('session bootstrap and logout wire realtime connection lifecycle to auth state', () => {
  const bootstrap = read('src/components/app/session-bootstrap.tsx');
  const session = read('src/services/auth/session.ts');
  const realtime = read('src/realtime/client.ts');
  const friendUnreadStore = read('src/stores/friendActivityUnreadStore.ts');

  assert.match(bootstrap, /connectRealtime/);
  assert.match(bootstrap, /disconnectRealtime/);
  assert.match(bootstrap, /hasHydrated/);
  assert.match(bootstrap, /accessToken/);

  // session.ts no longer imports disconnectRealtime directly; realtime
  // client registers itself via registerLogoutHandler so session.ts can
  // invoke handlers without a circular import.
  assert.match(session, /registerLogoutHandler/);
  assert.match(realtime, /registerLogoutHandler\(disconnectRealtime\)/);
  assert.match(session, /useTabBadgeStore/);
  assert.match(session, /reset\(\)/);

  assert.match(friendUnreadStore, /useTabBadgeStore/);
  assert.match(friendUnreadStore, /setContactsUnread/);
});

test('chat connection rebinds when the authoritative user arrives', () => {
  const bootstrap = read('src/components/app/session-bootstrap.tsx');

  // 冷启动可能是「安全存储里的 token 还在、单独持久化的 user 快照丢了或是旧的」。
  // 用 getState() 读一次 user 的话:快照缺失 → 压根不连,而 /auth/me 成功后
  // 只调 setUser、本 effect 不重跑,要等一次切前后台才补上;快照是上一个账号 →
  // 用错身份连上,收发方向与未读全按错的 currentUserId 算。
  assert.match(bootstrap, /const userId = useAuthStore\(\(state\) => state\.user\?\.id \?\? null\)/);
  assert.match(
    bootstrap,
    /connectChat\(accessToken, userId\);[\s\S]*?\}, \[accessToken, hasHydrated, onboardingRequired, userId\]\);/,
  );
  // chat 与 realtime 拆成两个 effect:userId 变化不该连带把 realtime 断开重连。
  assert.match(
    bootstrap,
    /connectRealtime\(accessToken\);[\s\S]*?\}, \[accessToken, hasHydrated, onboardingRequired\]\);/,
  );

  // 而且 connectChat 本身要认身份:已连着但连的是别人时必须重连。
  const socketManager = read('src/chat-core/socket-manager.ts');
  assert.match(
    socketManager,
    /if \(socket\?\.connected && store\.currentUserId === userId\) return;/,
  );
});

test('realtime profile refresh events handle rejected auth refreshes', () => {
  const client = read('src/realtime/client.ts');

  assert.match(client, /refreshCurrentUserSummary\(\)\.catch/);
  assert.doesNotMatch(client, /void refreshCurrentUserSummary\(\);/);
});

test('realtime reports bounded, content-free failures for its critical blind spots', () => {
  const client = read('src/realtime/client.ts');

  assert.match(client, /import \{ reportError \} from '@\/observability\/sentry'/);
  assert.match(client, /reportRealtimeFailureOnce\('malformedPayload'/);
  assert.match(client, /reportRealtimeFailureOnce\('authFrameSend'/);
  assert.match(client, /reportRealtimeConnectionOutage\(/);
  assert.match(client, /operation: 'realtime'/);
  assert.doesNotMatch(
    client,
    /reportError\([^\n]*rawData|reportError\([^\n]*normalizedToken/,
  );
});
