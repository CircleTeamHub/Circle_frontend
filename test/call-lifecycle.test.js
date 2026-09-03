const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { withObservabilityStubs } = require('./helpers/observability-stubs');

function loadTsModule(relativePath, stubs = {}) {
  const filePath = path.join(process.cwd(), relativePath);
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      baseUrl: process.cwd(),
      paths: { '@/*': ['src/*'] },
    },
    fileName: filePath,
  }).outputText;

  const context = {
    module: { exports: {} },
    exports: {},
    __DEV__: false,
    require: withObservabilityStubs((specifier) =>
      specifier in stubs ? stubs[specifier] : require(specifier)),
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const callSession = (overrides = {}) => ({
  id: 'call-1',
  status: 'ACTIVE',
  initiator: { id: 'someone-else' },
  ...overrides,
});

/**
 * 装载 call-session-teardown，并把它依赖的后端 / store 换成可观测的桩。
 * `events` 按发生顺序记录，用来断言「只通知一次」和 reset 的相对次序。
 */
function loadTeardownHarness({ activeCall = null, selfId = 'me', leaveImpl } = {}) {
  const events = [];
  const state = { activeCall };
  let logoutHandler;

  const teardown = loadTsModule('src/features/call/call-session-teardown.ts', {
    '@/services/auth/session': {
      registerLogoutHandler: (handler) => {
        logoutHandler = handler;
        return () => {};
      },
    },
    '@/features/call/store/use-call-store': {
      useCallStore: {
        getState: () => ({
          activeCall: state.activeCall,
          resetCallState: () => {
            state.activeCall = null;
            events.push('reset');
          },
        }),
      },
    },
    '@/stores/authStore': {
      useAuthStore: { getState: () => ({ user: selfId ? { id: selfId } : null }) },
    },
    '@/services/api/calls': {
      leaveCall: async (callId) => {
        events.push(`leave:${callId}`);
        if (leaveImpl) await leaveImpl();
      },
      cancelCall: async (callId) => {
        events.push(`cancel:${callId}`);
      },
    },
  });

  return {
    ...teardown,
    events,
    state,
    getLogoutHandler: () => logoutHandler,
  };
}

// C-08 ②: logout must clear an in-flight incoming call / active call so account
// A's ring popup can't bleed into account B. The teardown side-effect module
// registers a logout handler that calls resetCallState.
test('call-session-teardown registers a logout handler that clears call state (C-08)', () => {
  const harness = loadTeardownHarness({ activeCall: callSession() });

  assert.equal(typeof harness.getLogoutHandler(), 'function');
  harness.getLogoutHandler()();
  assert.deepEqual(harness.events, ['reset']);
});

// P10-1: 只断开 LiveKit 而不通知后端，会把自己永远留在成员列表里显示为 JOINED。
// 返回手势 / 卸载路径以前就是这样：room.disconnect() 之外什么都没做。
test('leaving an active call notifies the backend and clears local state (P10-1)', async () => {
  const harness = loadTeardownHarness({ activeCall: callSession() });

  await harness.leaveActiveCall();

  assert.deepEqual(harness.events, ['leave:call-1', 'reset']);
  assert.equal(harness.state.activeCall, null);
});

test('leaving twice only notifies the backend once (P10-1)', async () => {
  const harness = loadTeardownHarness({ activeCall: callSession() });

  await harness.leaveActiveCall();
  // 挂断按钮跑完后 router.back() 会紧接着卸载通话界面，卸载副作用会再调一次。
  await harness.leaveActiveCall();

  assert.deepEqual(harness.events, ['leave:call-1', 'reset']);
});

test('an unmount racing an in-flight hangup does not double-notify (P10-1)', async () => {
  const inFlight = deferred();
  const harness = loadTeardownHarness({
    activeCall: callSession(),
    leaveImpl: () => inFlight.promise,
  });

  // 挂断按钮发起的通知还在飞，用户就用返回手势离开了界面。
  const fromButton = harness.leaveActiveCall();
  const fromUnmount = harness.leaveActiveCall();

  inFlight.resolve();
  await Promise.all([fromButton, fromUnmount]);

  assert.deepEqual(harness.events, ['leave:call-1', 'reset']);
});

// 对端结束通话时 handleCallEnded 已经清空了 activeCall —— 这时卸载不该再补一条 leave。
test('leaving is a no-op once the call has already ended (P10-1)', async () => {
  const harness = loadTeardownHarness({ activeCall: null });

  await harness.leaveActiveCall();

  assert.deepEqual(harness.events, []);
});

test('the caller canceling their own ringing call uses cancelCall (P10-1)', async () => {
  const harness = loadTeardownHarness({
    activeCall: callSession({ status: 'RINGING', initiator: { id: 'me' } }),
    selfId: 'me',
  });

  await harness.leaveActiveCall();

  assert.deepEqual(harness.events, ['cancel:call-1', 'reset']);
});

test('leaving someone else\'s ringing call uses leaveCall (P10-1)', async () => {
  const harness = loadTeardownHarness({
    activeCall: callSession({ status: 'RINGING', initiator: { id: 'someone-else' } }),
    selfId: 'me',
  });

  await harness.leaveActiveCall();

  assert.deepEqual(harness.events, ['leave:call-1', 'reset']);
});

// 通知失败不能把用户锁在一个 LiveKit 已经断开的通话界面上。
test('a failed leave notification still tears down local call state (P10-1)', async () => {
  const harness = loadTeardownHarness({
    activeCall: callSession(),
    leaveImpl: () => Promise.reject(new Error('offline')),
  });

  await harness.leaveActiveCall();

  assert.deepEqual(harness.events, ['leave:call-1', 'reset']);
  assert.equal(harness.state.activeCall, null);
});

// leave 请求可能飞好几秒，期间完全可能来一通新的电话。
test('a new incoming call during an in-flight leave is not wiped (P10-1)', async () => {
  const inFlight = deferred();
  const harness = loadTeardownHarness({
    activeCall: callSession({ id: 'call-1' }),
    leaveImpl: () => inFlight.promise,
  });

  const leaving = harness.leaveActiveCall();
  const incoming = callSession({ id: 'call-2' });
  harness.state.activeCall = incoming;

  inFlight.resolve();
  await leaving;

  assert.deepEqual(harness.events, ['leave:call-1']);
  assert.equal(harness.state.activeCall, incoming, 'the new call must survive');
});

// 幂等标记必须随着退出结束而释放，否则被重新邀请回同一通群聊时又会变成幽灵成员。
test('re-joining the same call after leaving can notify again (P10-1)', async () => {
  const harness = loadTeardownHarness({ activeCall: callSession() });

  await harness.leaveActiveCall();
  harness.state.activeCall = callSession();
  await harness.leaveActiveCall();

  assert.deepEqual(harness.events, ['leave:call-1', 'reset', 'leave:call-1', 'reset']);
});

// C-08 ③ + P10-1: 卸载（返回手势 / router.back / 通话结束）必须同时通知后端并断开
// LiveKit，否则要么留下幽灵成员，要么麦克风常热。
test('GroupCallScreen routes its unmount through leaveActiveCall and disconnects LiveKit', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/features/call/screens/GroupCallScreen.tsx'),
    'utf8',
  );

  assert.match(
    src,
    /useEffect\(\(\)\s*=>\s*\{\s*return\s*\(\)\s*=>\s*\{\s*void leaveActiveCall\(\);\s*room\.disconnect\(\)/,
  );
  // 挂断按钮也必须走同一个出口，不能自己再拼一条 leaveCall/cancelCall 路径。
  assert.match(src, /leaveActiveCall\(\)/);
  assert.doesNotMatch(src, /\bcancelCall\b/);
  assert.doesNotMatch(src, /\bleaveCall\b/);
});

test('GroupCallScreen fallback exits notify the backend before navigating back', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/features/call/screens/GroupCallScreen.tsx'),
    'utf8',
  );

  assert.doesNotMatch(src, /\bresetCallState\b/);
  assert.match(
    src,
    /const handleFallbackBack = useCallback\(\(\) => \{\s*void leaveActiveCall\(\);\s*router\.back\(\);\s*\}, \[\]\);/,
  );
  assert.equal(
    (src.match(/onPress=\{handleFallbackBack\}/g) ?? []).length,
    2,
    'both fallback back buttons must use the backend-aware exit',
  );
});
