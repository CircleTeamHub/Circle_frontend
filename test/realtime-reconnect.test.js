const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { withObservabilityStubs } = require('./helpers/observability-stubs');

const RECONNECT_MAX_MS = 30_000;
// scheduleReconnect 里 delay = baseDelay + baseDelay * 0.2 * Math.random()
const JITTER_CEILING = 1.2;

function loadRealtimeHarness() {
  const filePath = path.join(process.cwd(), 'src/realtime/client.ts');
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;

  const sockets = [];

  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.sent = [];
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      sockets.push(this);
    }

    send(data) {
      if (this.sendError) throw this.sendError;
      this.sent.push(data);
    }

    close() {
      this.readyState = FakeWebSocket.CLOSED;
    }
  }

  // 极简 fake timer：只需要「读出下一个 delay」和「手动触发」。
  let nextTimerId = 1;
  const timers = new Map();

  const realtimeConnected = [];
  const clearedSessions = [];
  const sentryReports = [];
  const stubStore = (state) => ({ getState: () => state });

  const context = {
    module: { exports: {} },
    exports: {},
    __DEV__: false,
    console,
    WebSocket: FakeWebSocket,
    setTimeout: (fn, delay) => {
      const id = nextTimerId++;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
    require: withObservabilityStubs((request) => {
      switch (request) {
        case '@/constants/config':
          return { REALTIME_WS_URL: 'wss://realtime.example.test/ws' };
        case '@/services/api/plaza':
          return { fetchMySignupsUnreadCount: async () => 0 };
        case '@/services/api/friends':
          return { fetchUnreadFriendActivityCount: async () => 0 };
        case '@/services/api/auth':
          return { fetchCurrentUser: async () => ({ id: 'user-1' }) };
        case '@/services/api/coin':
          return { fetchWallet: async () => ({ balance: 0 }) };
        case '@/services/api/notifications':
          return {
            fetchNotifications: async () => [],
            fetchNotificationUnreadSummary: async () => ({
              discoverUnread: 0,
              momentsUnread: 0,
              circleUnread: 0,
              profileUnread: 0,
              totalUnread: 0,
            }),
          };
        case '@/features/notifications/utils/notification-domain':
          return {
            BELL_NOTIFICATION_TYPES: new Set([
              'TRACE_LIKE',
              'TRACE_COMMENT',
              'COMMENT_REPLY',
              'TRACE_MENTION',
              'PROFILE_LIKE',
              'CIRCLE_VERIFICATION_REQUESTED',
              'CIRCLE_INVITATION_APPROVED',
              'CIRCLE_INVITATION_REJECTED',
              'CIRCLE_ADMIN_OVERRIDE_APPROVED',
              'CIRCLE_POST_PUBLISHED',
              'CIRCLE_POST_AUTO_ENDED',
              'CIRCLE_POST_COLLABORATION_RECOGNIZED',
            ]),
          };
        case '@/features/notifications/store/use-notification-center-store':
          return {
            useNotificationCenterStore: stubStore({
              interactive: [],
              setInteractive: () => {},
            }),
          };
        case '@/features/notifications/store/use-notification-snackbar-store':
          return {
            useNotificationSnackbarStore: stubStore({
              enqueueNotification: () => {},
            }),
          };
        case '@/features/discover/store/use-moments-feed-signal-store':
          return {
            useMomentsFeedSignalStore: stubStore({ bump: () => {} }),
          };
        case '@/features/discover/store/use-circle-notification-store':
          return {
            useCircleNotificationStore: stubStore({
              inAppEnabled: true,
              bannerEnabled: true,
            }),
          };
        case '@/features/call/store/use-call-store':
          return { useCallStore: stubStore({}) };
        case '@/features/call/realtime-guards':
          return {
            isCallInvitePayload: () => false,
            isCallParticipantPayload: () => false,
            isCallStatePayload: () => false,
          };
        case '@/services/auth/session':
          return {
            registerLogoutHandler: () => () => {},
            clearLocalSession: () => {
              clearedSessions.push(true);
              return Promise.resolve();
            },
          };
        case '@/stores/authStore':
          return { useAuthStore: stubStore({ setUser: () => {} }) };
        case '@/stores/tabBadgeStore':
          return {
            useTabBadgeStore: stubStore({
              applySnapshot: () => {},
              setContactsUnread: () => {},
              setDiscoverUnread: () => {},
              setSignupUnread: () => {},
              setProfileUnread: () => {},
              setSystemUnread: () => {},
              setRealtimeConnected: (value) => realtimeConnected.push(value),
            }),
          };
        case '@/stores/walletRealtimeStore':
          return {
            useWalletRealtimeStore: stubStore({ setRealtimeBalance: () => {} }),
          };
        case '@/observability/sentry':
          return {
            reportError: (error, reportContext) =>
              sentryReports.push({ error, context: reportContext }),
          };
        default:
          return require(request);
      }
    }),
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });

  function pendingTimer() {
    const entries = [...timers.entries()];
    if (entries.length > 1) {
      throw new Error(`expected at most one reconnect timer, got ${entries.length}`);
    }
    return entries[0] ?? null;
  }

  return {
    ...context.module.exports,
    sockets,
    realtimeConnected,
    clearedSessions,
    sentryReports,
    latestSocket: () => sockets[sockets.length - 1],
    pendingDelay: () => pendingTimer()?.[1].delay ?? null,
    hasPendingReconnect: () => pendingTimer() !== null,
    // 触发挂起的重连定时器，返回它原本的 delay。
    runPendingReconnect: () => {
      const entry = pendingTimer();
      if (!entry) throw new Error('no reconnect timer scheduled');
      const [id, timer] = entry;
      timers.delete(id);
      timer.fn();
      return timer.delay;
    },
  };
}

test('malformed realtime reporting resets only when the session lifecycle ends', () => {
  const harness = loadRealtimeHarness();
  harness.connectRealtime('token-a');
  openLatestSocket(harness);
  harness.latestSocket().onmessage({ data: 'private malformed payload' });
  harness.latestSocket().onmessage({ data: 'another malformed payload' });
  assert.equal(harness.sentryReports.length, 1);

  harness.disconnectRealtime();
  harness.connectRealtime('token-b');
  openLatestSocket(harness);
  harness.latestSocket().onmessage({ data: 'new-session malformed payload' });
  assert.equal(harness.sentryReports.length, 2);
  assert.deepEqual(
    { ...harness.sentryReports[1].context },
    { operation: 'realtime', kind: 'malformedPayload' },
  );
});

test('schema-invalid known realtime frames are reported as malformed payloads', () => {
  const harness = loadRealtimeHarness();
  harness.connectRealtime('token-a');
  openLatestSocket(harness);

  harness.latestSocket().onmessage({
    data: JSON.stringify({ type: 'call.invite', payload: {} }),
  });
  harness.latestSocket().onmessage({
    data: JSON.stringify({ type: 'call.invite', payload: {} }),
  });

  assert.equal(harness.sentryReports.length, 1);
  assert.deepEqual(
    { ...harness.sentryReports[0].context },
    { operation: 'realtime', kind: 'malformedPayload' },
  );
});

test('an auth-frame send failure never marks the socket connected and still retries after close', () => {
  const harness = loadRealtimeHarness();
  harness.connectRealtime('token-a');
  harness.latestSocket().sendError = new Error('send failed');

  openLatestSocket(harness);

  assert.equal(harness.realtimeConnected.includes(true), false);
  assert.deepEqual(
    { ...harness.sentryReports[0].context },
    { operation: 'realtime', kind: 'authFrameSend' },
  );

  failLatestSocket(harness);
  assert.equal(harness.hasPendingReconnect(), true);
});

// 让最新的 socket 以「连不上」收场：网关拒绝 / 后端重启 / 断网都走 onclose。
function failLatestSocket(harness) {
  const socket = harness.latestSocket();
  socket.readyState = 3;
  socket.onclose();
}

function openLatestSocket(harness) {
  const socket = harness.latestSocket();
  socket.readyState = 1;
  socket.onopen();
}

// 认证通过后网关立刻回推一帧 badge.snapshot。收到帧才代表这条连接真的可用 ——
// 握手成功之后网关仍可能以 1008 把它踢掉。
function deliverSnapshot(harness) {
  harness.latestSocket().onmessage({
    data: JSON.stringify({ type: 'badge.snapshot', payload: {} }),
  });
}

// 网关主动拒绝：code + reason 都带上，和后端 REVOKED_CLOSE_* 对齐。
function rejectLatestSocket(harness, code, reason) {
  const socket = harness.latestSocket();
  socket.readyState = 3;
  socket.onclose({ code, reason });
}

// P0-12d: 连续失败 10 次后永久放弃，意味着来电邀请和红点在本次进程剩余时间里
// 再也不会到达，而且用户完全无感。后端滚动重启 / 过夜断网都能轻松打满 10 次。
test('realtime keeps rescheduling reconnects far past the old 10-attempt cap', () => {
  const harness = loadRealtimeHarness();
  harness.connectRealtime('token-a');
  assert.equal(harness.sockets.length, 1);

  for (let attempt = 1; attempt <= 25; attempt += 1) {
    failLatestSocket(harness);
    assert.equal(
      harness.hasPendingReconnect(),
      true,
      `expected a reconnect to be scheduled after failure #${attempt}`,
    );
    harness.runPendingReconnect();
    assert.equal(harness.sockets.length, attempt + 1);
  }
});

test('realtime reports one outage at the third consecutive failure and resets after authentication', () => {
  const harness = loadRealtimeHarness();
  harness.connectRealtime('token-a');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    failLatestSocket(harness);
    harness.runPendingReconnect();
  }
  assert.equal(harness.sentryReports.length, 0);

  failLatestSocket(harness);
  assert.equal(harness.sentryReports.length, 1);
  assert.deepEqual(
    { ...harness.sentryReports[0].context },
    {
      operation: 'realtime',
      kind: 'consecutiveConnectionFailures',
      attempts: 3,
    },
  );
  harness.runPendingReconnect();

  failLatestSocket(harness);
  harness.runPendingReconnect();
  assert.equal(harness.sentryReports.length, 1, 'one alert per outage');

  deliverSnapshot(harness);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    failLatestSocket(harness);
    if (attempt < 2) harness.runPendingReconnect();
  }
  assert.equal(harness.sentryReports.length, 2, 'a recovered session can alert again');
});

test('reconnect backoff escalates and then clamps at RECONNECT_MAX_MS', () => {
  const harness = loadRealtimeHarness();
  harness.connectRealtime('token-a');

  const delays = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    failLatestSocket(harness);
    delays.push(harness.runPendingReconnect());
  }

  // 每档都是 base + [0, 20%) 抖动，逐档翻倍直到撞上 30s 上限。
  const expectedBases = [
    1_000, 2_000, 4_000, 8_000, 16_000,
    RECONNECT_MAX_MS, RECONNECT_MAX_MS, RECONNECT_MAX_MS,
    RECONNECT_MAX_MS, RECONNECT_MAX_MS, RECONNECT_MAX_MS, RECONNECT_MAX_MS,
  ];
  delays.forEach((delay, index) => {
    const base = expectedBases[index];
    assert.ok(
      delay >= base && delay < base * JITTER_CEILING,
      `delay #${index} (${delay}) should sit in [${base}, ${base * JITTER_CEILING})`,
    );
  });

  // 封顶的是延迟，不是次数：再失败多少次也不会超过 30s * 抖动。
  for (let attempt = 0; attempt < 20; attempt += 1) {
    failLatestSocket(harness);
    const delay = harness.runPendingReconnect();
    assert.ok(delay < RECONNECT_MAX_MS * JITTER_CEILING);
  }
});

test('a successful connection resets the backoff to the first step', () => {
  const harness = loadRealtimeHarness();
  harness.connectRealtime('token-a');

  for (let attempt = 0; attempt < 6; attempt += 1) {
    failLatestSocket(harness);
    harness.runPendingReconnect();
  }
  failLatestSocket(harness);
  assert.ok(harness.pendingDelay() >= RECONNECT_MAX_MS);
  harness.runPendingReconnect();

  openLatestSocket(harness);
  deliverSnapshot(harness);
  failLatestSocket(harness);

  const delay = harness.pendingDelay();
  assert.ok(
    delay >= 1_000 && delay < 1_000 * JITTER_CEILING,
    `backoff should restart at ~1s after a successful open, got ${delay}`,
  );
});

// 回到前台 / token 轮换是「显式连接意图」：立刻重连，不等退避跑完。
test('an explicit connect resets the backoff and reconnects immediately', () => {
  const harness = loadRealtimeHarness();
  harness.connectRealtime('token-a');

  for (let attempt = 0; attempt < 6; attempt += 1) {
    failLatestSocket(harness);
    harness.runPendingReconnect();
  }
  failLatestSocket(harness);
  assert.equal(harness.hasPendingReconnect(), true);

  const socketsBefore = harness.sockets.length;
  harness.connectRealtime('token-a');

  assert.equal(harness.hasPendingReconnect(), false, 'pending backoff timer should be dropped');
  assert.equal(harness.sockets.length, socketsBefore + 1, 'should reconnect immediately');

  failLatestSocket(harness);
  const delay = harness.pendingDelay();
  assert.ok(
    delay >= 1_000 && delay < 1_000 * JITTER_CEILING,
    `backoff should restart at ~1s after an explicit connect, got ${delay}`,
  );
});

// 登出是唯一的永久终止条件。
test('logout stops reconnecting permanently', () => {
  const harness = loadRealtimeHarness();
  harness.connectRealtime('token-a');

  failLatestSocket(harness);
  harness.runPendingReconnect();

  // 先抓住 onclose：真实世界里 close 事件可能已经排在队列上、logout 之后才派发。
  const socket = harness.latestSocket();
  const queuedOnClose = socket.onclose;

  harness.disconnectRealtime();
  assert.equal(harness.hasPendingReconnect(), false, 'logout should drop the pending backoff timer');
  assert.equal(socket.onclose, null, 'logout should detach the socket handlers');

  queuedOnClose();
  assert.equal(harness.hasPendingReconnect(), false, 'logout must not schedule a reconnect');
});

// 后端把会话撤销应用到活跃 WebSocket 之后，被踢的连接如果照常重连，就会在
// 「握手成功 → 认证 → 被 1008 踢 → 重连」上打转，直到 token 自然过期（约 1h）。
test('a revoked session stops reconnecting and logs out instead of looping', () => {
  const harness = loadRealtimeHarness();
  harness.connectRealtime('token-a');
  openLatestSocket(harness);
  deliverSnapshot(harness);

  rejectLatestSocket(harness, 1008, 'Session revoked');

  assert.equal(
    harness.hasPendingReconnect(),
    false,
    'a revoked session must not schedule a reconnect',
  );
  assert.equal(
    harness.clearedSessions.length,
    1,
    'a revoked session should fall out through the same exit as an HTTP 401',
  );
});

// 同为 1008，但连接数超限是暂时的（另一台设备下线就好了），必须继续重连。
test('other 1008 rejections still reconnect, on an escalating backoff', () => {
  const harness = loadRealtimeHarness();
  harness.connectRealtime('token-a');
  openLatestSocket(harness);
  deliverSnapshot(harness);

  rejectLatestSocket(harness, 1008, 'Too many connections');

  assert.equal(harness.hasPendingReconnect(), true);
  assert.equal(harness.clearedSessions.length, 0, 'must not log the user out');
});

// 风暴的成因：网关是在认证「之后」才踢人的，所以握手一定会先成功。退避若在
// onopen 归零，每一轮都从最短延迟重来，等于每秒锤一次后端。
test('a socket killed right after the handshake keeps escalating the backoff', () => {
  const harness = loadRealtimeHarness();
  harness.connectRealtime('token-a');

  const delays = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    // 握手成功、认证帧发出，但一帧都没收到就被踢 —— 连接从未真正可用。
    openLatestSocket(harness);
    rejectLatestSocket(harness, 1008, 'Too many connections');
    delays.push(harness.runPendingReconnect());
  }

  const expectedBases = [1_000, 2_000, 4_000, 8_000, 16_000];
  delays.forEach((delay, index) => {
    const base = expectedBases[index];
    assert.ok(
      delay >= base && delay < base * JITTER_CEILING,
      `delay #${index} (${delay}) should sit in [${base}, ${base * JITTER_CEILING}) — ` +
        'a handshake that never got authenticated must not reset the backoff',
    );
  });
});

test('reconnected sockets re-send the auth frame', () => {
  const harness = loadRealtimeHarness();
  harness.connectRealtime('token-a');

  for (let attempt = 0; attempt < 15; attempt += 1) {
    failLatestSocket(harness);
    harness.runPendingReconnect();
  }
  openLatestSocket(harness);

  assert.deepEqual(JSON.parse(harness.latestSocket().sent[0]), {
    type: 'auth',
    token: 'token-a',
  });
  assert.equal(harness.realtimeConnected.at(-1), true);
});
