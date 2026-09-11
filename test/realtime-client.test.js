/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { loadTsModule } = require('./helpers/load-ts-module');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

/** 遍历 src 下的 ts/tsx 源码（跳过测试与生成物）。 */
function* walkSources(rel) {
  for (const entry of fs.readdirSync(path.join(root, rel), {
    withFileTypes: true,
  })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === 'generated' || entry.name === 'node_modules') continue;
      yield* walkSources(child);
    } else if (/\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name)) {
      yield child;
    }
  }
}

/** 圈子通知 store 的真身（形状断言要读真实 state，不是源码文本）。 */
function loadCircleNotificationStore() {
  const backing = new Map();
  const shims = {
    zustand: require('zustand'),
    'zustand/middleware': require('zustand/middleware'),
    '@/storage': {
      mmkvJsonStorage: {
        getItem: (key) => backing.get(key) ?? null,
        setItem: (key, value) => backing.set(key, value),
        removeItem: (key) => backing.delete(key),
      },
    },
  };
  return loadTsModule(
    'src/features/discover/store/use-circle-notification-store.ts',
    {
      requireShim: (specifier) => {
        if (shims[specifier]) return shims[specifier];
        throw new Error(`unexpected import: ${specifier}`);
      },
    },
  );
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

  // 白名单本体在 notification-domain（= 两个铃铛类型的并集），client 只引用它。
  assert.match(client, /BELL_NOTIFICATION_TYPES/);
  const domain = read('src/features/notifications/utils/notification-domain.ts');
  for (const type of [
    'TRACE_LIKE',
    'TRACE_COMMENT',
    'COMMENT_REPLY',
    'CIRCLE_VERIFICATION_REQUESTED',
    'CIRCLE_INVITATION_APPROVED',
    'CIRCLE_INVITATION_REJECTED',
    'CIRCLE_ADMIN_OVERRIDE_APPROVED',
    'CIRCLE_POST_AUTO_ENDED',
    'PROFILE_LIKE',
  ]) {
    assert.match(domain, new RegExp(`'${type}'`));
  }
  // 好友申请不进铃铛列表（专属「新的朋友」收件箱），横幅不受影响。
  assert.doesNotMatch(domain, /'FRIEND_REQUEST_RECEIVED'/);
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

  // 圈子通知（CIRCLE_*）的横幅受「圈子通知设置」总闸控制：关掉时不弹横幅
  // （但通知仍在门前写进铃铛列表，数据不丢）。
  assert.match(client, /useCircleNotificationStore/);
  assert.match(client, /payload\.type\.startsWith\('CIRCLE_'\)/);
  assert.match(client, /circleBannerAllowed\(useCircleNotificationStore\.getState\(\)\)/);
  // 总闸也管红点：关掉时未读计数不展示（服务端照常累加）。门控走 store 的
  // gateCircleUnread —— 每一条写未读的路径都要过它，行为断言见
  // test/realtime-reconnect.test.js。
  assert.match(client, /gateCircleUnread\(snapshot, useCircleNotificationStore\.getState\(\)\)/);
  // 门控发生在铃铛 setInteractive 之后、横幅 enqueueNotification 之前。
  assert.match(
    client,
    /startsWith\('CIRCLE_'\)[\s\S]*?return;[\s\S]*?enqueueNotification\(payload\)/,
  );
});

// 前一版这里断言的是「文案只承诺应用内展示」；改三档时它被换成一串纯 source
// grep —— 于是新旧文案在同一个对象里并存、JSON.parse 取最后一个（= 旧文案）时
// 谁都没红。所以这一条只看**生效后的** t() 取值（而不是文件里写了什么），
// 再配合 store 的真实形状。
test('三档的生效文案承诺的是总闸，不是「只管应用内展示」', () => {
  const locales = {
    zh: {
      global: '全局接收圈子通知',
      // 关掉必须是「全关」：这个开关同时停掉横幅、声音、红点和离线推送。
      globalOff: /所有通知/,
      // 旧文案只承诺隐藏横幅 —— 它回来就等于开关又开始说谎。
      stale: /隐藏应用内圈子通知横幅|允许控制应用内的通知展示|控制使用应用时圈子通知的展示/,
      offlinePromise: /离线/,
    },
    en: {
      global: 'Receive Circle Notifications',
      globalOff: /all notifications disabled/i,
      stale: /hide in-app Circle notification banners|in-app presentation controls|presentation while using the app/i,
      offlinePromise: /offline/i,
    },
    ja: {
      global: 'サークル通知を受け取る',
      globalOff: /すべての通知/,
      stale: /バナーを非表示|アプリ内の通知表示を設定|表示方法を設定/,
      offlinePromise: /オフライン/,
    },
    ko: {
      global: '서클 알림 받기',
      globalOff: /모든 알림/,
      stale: /배너를 숨깁니다|알림 표시를 설정할 수 있습니다|표시 방식을 설정합니다/,
      offlinePromise: /오프라인/,
    },
    es: {
      global: 'Recibir notificaciones de círculos',
      globalOff: /todas las notificaciones/i,
      stale: /oculta los banners del círculo|controlar su presentación|se muestran las notificaciones de Círculo mientras usas la app/i,
      offlinePromise: /sin conexión|push/i,
    },
  };

  for (const [name, expected] of Object.entries(locales)) {
    // JSON.parse 与 i18next 看到的是同一份：重复键只剩最后一个，
    // 所以这里读到的就是屏幕上真正显示的那句。
    const locale = JSON.parse(read(`src/i18n/locales/${name}.json`));
    const sheet = locale.discover.notifications;
    const profile = locale.settingsDetails.notifications;

    assert.equal(sheet.global, expected.global, `${name}: 弹层总闸文案`);
    // 两处入口共用同一份开关，文案也必须是同一句，否则用户以为是两个功能。
    assert.equal(profile.circleGlobal, expected.global, `${name}: 设置页总闸文案`);

    assert.match(sheet.globalOffHint, expected.globalOff, `${name}: 关闭态提示`);
    assert.match(sheet.globalOnHint, expected.offlinePromise, `${name}: 开启态提示`);
    assert.match(profile.circleGlobalHint, expected.offlinePromise, `${name}: 设置页提示`);

    for (const [key, copy] of Object.entries({
      globalOnHint: sheet.globalOnHint,
      globalOffHint: sheet.globalOffHint,
      circleGlobalHint: profile.circleGlobalHint,
    })) {
      assert.doesNotMatch(copy, expected.stale, `${name}.${key} 是旧的「只管展示」文案`);
    }

    // 三档齐全，每一档都有标题和两行提示。
    for (const key of [
      'global',
      'globalOnHint',
      'globalOffHint',
      'sound',
      'soundOnHint',
      'soundOffHint',
      'offline',
      'offlineOnHint',
      'offlineOffHint',
      'syncFailed',
    ]) {
      assert.equal(typeof sheet[key], 'string', `${name}: 缺 ${key}`);
      assert.ok(sheet[key].length > 0, `${name}: ${key} 是空串`);
    }
  }
});

test('三档 store 的形状与每一档的落点', () => {
  const { useCircleNotificationStore, circleBadgeAllowed, gateCircleUnread } =
    loadCircleNotificationStore();
  const client = read('src/realtime/client.ts');
  const snackbar = read(
    'src/features/notifications/components/NotificationSnackbarHost.tsx',
  );
  const toggles = read(
    'src/features/discover/components/circle-notification-toggles.tsx',
  );

  // store 的真实形状（而不是源码里有没有出现这几个字）。
  const state = useCircleNotificationStore.getState();
  for (const key of ['globalEnabled', 'soundEnabled', 'offlineEnabled']) {
    assert.equal(typeof state[key], 'boolean', `store 缺 ${key}`);
  }
  assert.equal(typeof state.resetForLogout, 'function');

  // 总闸 → 红点：关掉之后计数不进展示层。
  useCircleNotificationStore.setState({ globalEnabled: false });
  assert.equal(circleBadgeAllowed(useCircleNotificationStore.getState()), false);
  assert.equal(
    gateCircleUnread(
      { discoverUnread: 5, circleUnread: 2 },
      useCircleNotificationStore.getState(),
    ).circleUnread,
    0,
  );
  useCircleNotificationStore.setState({ globalEnabled: true });

  // 三档的落点各自接在真实执行处：横幅/红点在 realtime，声音在 snackbar host，
  // 离线推送的读写在共用 hook 里（弹层与设置页都用它）。
  assert.match(client, /circleBannerAllowed/);
  assert.match(client, /gateCircleUnread/);
  assert.match(snackbar, /circleSoundAllowed/);
  assert.match(snackbar, /notify\(\{ silent \}\)/);
  assert.match(toggles, /useCircleNotificationTiers/);
  const hook = read(
    'src/features/discover/hooks/use-circle-notification-tiers.ts',
  );
  assert.match(hook, /updateCircleOfflinePushEnabled/);
  assert.match(hook, /fetchCircleOfflinePushEnabled/);
});

// 个人设置页那三行此前直接 set 本地 store：「离线提醒」关了不通知服务端，
// 推送照来，下次打开弹层还会被 GET 翻回去。两处必须是同一个实现。
test('弹层与个人设置页用同一个三档 hook，没有第二份实现', () => {
  const profile = read(
    'src/features/profile/screens/NotificationSettingsScreen.tsx',
  );
  assert.match(profile, /useCircleNotificationTiers/);
  assert.doesNotMatch(
    profile,
    /useCircleNotificationStore/,
    '设置页不能绕过 hook 直接写 store',
  );

  // 同步只能有一个调用方；多一个就意味着有人又手写了一遍。
  const callers = [];
  for (const file of walkSources('src')) {
    if (file.endsWith('use-circle-notification-tiers.ts')) continue;
    if (file.endsWith('src/services/api/notifications.ts')) continue;
    if (read(file).includes('updateCircleOfflinePushEnabled')) callers.push(file);
  }
  assert.deepEqual(callers, [], `updateCircleOfflinePushEnabled 出现在 hook 之外: ${callers}`);
});

test('app settings search lists the three circle notification rows', () => {
  const appSettings = read('src/features/profile/screens/AppSettingsScreen.tsx');
  // 曾经列过一个 circleSound 却没有对应文案（早年删开关时留下的孤儿），
  // 现在三档都真实存在，搜索行必须与设置页一一对上。
  for (const key of ['circleGlobal', 'circleSound', 'circleOffline']) {
    assert.match(appSettings, new RegExp(`'${key}'`));
  }
});

test('circle plaza bell badge counts circle + signup unread, never the moments count', () => {
  const screen = read('src/features/discover/screens/CirclePlazaScreen.tsx');

  assert.match(screen, /useTabBadgeStore\(\(state\) => state\.circleUnread\)/);
  assert.match(screen, /useTabBadgeStore\(\(state\) => state\.signupUnread\)/);
  assert.match(screen, /circleBellUnread = circleUnread \+ signupUnread/);
  assert.match(screen, /Badge count=\{circleBellUnread\}/);
  // 朋友圈的互动未读绝不能出现在圈子铃铛上。
  assert.doesNotMatch(screen, /state\.momentsUnread/);
  assert.doesNotMatch(screen, /useTabBadgeStore\(\(state\) => state\.discoverUnread\)/);
  assert.doesNotMatch(screen, /useTabBadgeStore\(\(state\) => state\.systemUnread\)/);
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
    /if \(socket\?\.connected && store\.currentUserId === userId\) \{\s+void store\.purgeExpiredBurnMessages\(\);\s+return;\s+\}/,
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
