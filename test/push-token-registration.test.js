const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const SECRET_A = '11111111-1111-4111-8111-111111111111';
const SECRET_B = '22222222-2222-4222-8222-222222222222';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function loadRegistrar() {
  const filePath = path.join(
    process.cwd(),
    'src/features/notifications/components/PushNotificationTokenRegistrar.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filePath,
  }).outputText;
  const noopStore = Object.assign(() => undefined, { getState: () => ({}) });
  const context = {
    module: { exports: {} },
    exports: {},
    require: (specifier) => {
      if (specifier === 'react') {
        return {
          useEffect() {},
          useRef: (value) => ({ current: value }),
          useState: (value) => [value, () => {}],
        };
      }
      if (specifier === 'react-native') {
        return {
          AppState: { addEventListener: () => ({ remove() {} }) },
          Platform: { OS: 'ios' },
        };
      }
      if (specifier === 'expo-constants') {
        return { __esModule: true, default: { expoConfig: null } };
      }
      if (specifier === 'expo-crypto') return { randomUUID: () => SECRET_A };
      if (specifier === 'react/jsx-runtime') return {};
      if (specifier === '@/services/api/notifications') {
        return { registerPushToken() {}, revokePushToken() {} };
      }
      if (specifier === '@/services/auth/session') {
        return { registerLogoutHandler() {} };
      }
      if (specifier === '@/storage') {
        return { storage: { getString() {}, set() {}, remove() {} } };
      }
      if (specifier === '@/stores/authStore') return { useAuthStore: noopStore };
      if (specifier === '@/features/profile/store/use-app-settings-store') {
        return { useAppSettingsStore: noopStore };
      }
      if (specifier === '@/features/notifications/utils/report-failure') {
        return { reportNotificationFailure() {} };
      }
      if (specifier.startsWith('@/')) return {};
      return require(specifier);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

function makeHarness(options = {}) {
  const { createPushTokenRegistrationOrchestrator } = loadRegistrar();
  let stored = options.stored ?? null;
  let revocations = [...(options.revocations ?? [])];
  const registerCalls = [];
  const revokeCalls = [];
  const diagnostics = [];
  const failures = [];
  let secretCalls = 0;
  let moduleLoads = 0;
  const notifications = options.notifications ?? {
    IosAuthorizationStatus: { PROVISIONAL: 'provisional' },
    getPermissionsAsync: async () => ({ granted: true }),
    getExpoPushTokenAsync: async () => ({
      data: options.token ?? 'ExponentPushToken[default]',
    }),
  };
  const orchestrator = createPushTokenRegistrationOrchestrator({
    platform: options.platform ?? 'ios',
    appVersion: '1.0.0',
    getProjectId: () =>
      Object.prototype.hasOwnProperty.call(options, 'projectId')
        ? options.projectId
        : 'project-real',
    getStoredRegistration: () => stored,
    setStoredRegistration: (value) => {
      stored = value;
    },
    getPendingRevocations: () => revocations,
    setPendingRevocations: (value) => {
      revocations = [...value];
    },
    generateRevocationSecret: () => {
      secretCalls += 1;
      return options.generateRevocationSecret?.() ?? options.secret ?? SECRET_A;
    },
    loadNotificationsModule: async () => {
      moduleLoads += 1;
      return notifications;
    },
    registerPushToken: async (input) => {
      registerCalls.push(input);
      return options.registerPushToken?.(input, stored);
    },
    revokePushToken: async (token, revocationSecret) => {
      revokeCalls.push({ token, revocationSecret });
      return options.revokePushToken?.(token, revocationSecret);
    },
    reportFailure: (...args) => failures.push(args),
    reportDiagnostic: (...args) => diagnostics.push(args),
  });
  return {
    orchestrator,
    registerCalls,
    revokeCalls,
    diagnostics,
    failures,
    getStored: () => stored,
    getRevocations: () => revocations,
    getSecretCalls: () => secretCalls,
    getModuleLoads: () => moduleLoads,
  };
}

const enabled = (userId = 'user-1') => ({
  isAuthenticated: true,
  userId,
  pushEnabled: true,
});

test('first native run requests permission and registers a persisted pending secret', async () => {
  const permissionRequests = [];
  const notifications = {
    IosAuthorizationStatus: { PROVISIONAL: 'provisional' },
    getPermissionsAsync: async () => ({ granted: false, canAskAgain: true }),
    requestPermissionsAsync: async (request) => {
      permissionRequests.push(request);
      return { granted: false, ios: { status: 'provisional' } };
    },
    getExpoPushTokenAsync: async (request) => {
      assert.equal(request.projectId, 'project-real');
      return { data: 'ExponentPushToken[first]' };
    },
  };
  const harness = makeHarness({
    notifications,
    registerPushToken: async ({ revocationSecret }, activeCandidate) => {
      assert.equal(activeCandidate.status, 'pending');
      assert.equal(activeCandidate.revocationSecret, revocationSecret);
    },
  });

  await harness.orchestrator.sync(enabled());

  assert.equal(permissionRequests.length, 1);
  assert.equal(permissionRequests[0].ios.allowAlert, true);
  assert.equal(permissionRequests[0].ios.allowBadge, true);
  assert.equal(permissionRequests[0].ios.allowSound, true);
  assert.equal(harness.registerCalls[0].revocationSecret, SECRET_A);
  assert.equal(harness.getSecretCalls(), 1);
  assert.equal(harness.getStored().status, 'registered');
});

test('permanently denied permission is not requested or registered', async () => {
  let requests = 0;
  const harness = makeHarness({
    notifications: {
      IosAuthorizationStatus: { PROVISIONAL: 'provisional' },
      getPermissionsAsync: async () => ({ granted: false, canAskAgain: false }),
      requestPermissionsAsync: async () => {
        requests += 1;
      },
    },
  });
  await harness.orchestrator.sync(enabled());
  assert.equal(requests, 0);
  assert.equal(harness.registerCalls.length, 0);
});

test('completed denial prompts once per user, while a request exception may retry', async () => {
  let requestCalls = 0;
  const requestError = new Error('native failure');
  const notifications = {
    IosAuthorizationStatus: { PROVISIONAL: 'provisional' },
    getPermissionsAsync: async () => ({ granted: false, canAskAgain: true }),
    requestPermissionsAsync: async () => {
      requestCalls += 1;
      if (requestCalls === 1) throw requestError;
      return { granted: false, canAskAgain: true };
    },
  };
  const harness = makeHarness({ notifications });
  await assert.rejects(harness.orchestrator.sync(enabled()), requestError);
  await harness.orchestrator.sync(enabled());
  await harness.orchestrator.sync(enabled());
  assert.equal(requestCalls, 2);
});

test('web never loads native registration and missing project id stops with a diagnostic', async () => {
  const web = makeHarness({ platform: 'web' });
  web.orchestrator.flushPendingRevocations();
  await web.orchestrator.sync(enabled());
  assert.equal(web.getModuleLoads(), 0);
  assert.equal(web.registerCalls.length, 0);

  const missing = makeHarness({ projectId: null });
  await missing.orchestrator.sync(enabled());
  assert.equal(missing.registerCalls.length, 0);
  assert.equal(missing.diagnostics[0][0], 'push_token_project_id_missing');
});

test('logout returns immediately during a hung PUT and persists a revocation tombstone', async () => {
  const put = deferred();
  const putStarted = deferred();
  const harness = makeHarness({
    registerPushToken: async () => {
      putStarted.resolve();
      return put.promise;
    },
  });
  const syncPromise = harness.orchestrator.sync(enabled());
  await putStarted.promise;

  const result = harness.orchestrator.logout();

  assert.equal(result, undefined);
  assert.equal(harness.getStored(), null);
  assert.equal(harness.getRevocations().length, 1);
  assert.equal(harness.revokeCalls.length, 0);
  put.resolve();
  await syncPromise;
});

test('a PUT that completes after logout is followed by public revoke with the same secret', async () => {
  const put = deferred();
  const putStarted = deferred();
  const order = [];
  const harness = makeHarness({
    registerPushToken: async ({ revocationSecret }) => {
      order.push(`PUT ${revocationSecret}`);
      putStarted.resolve();
      return put.promise;
    },
    revokePushToken: async (_token, secret) => {
      order.push(`REVOKE ${secret}`);
    },
  });
  const syncPromise = harness.orchestrator.sync(enabled());
  await putStarted.promise;
  harness.orchestrator.logout();
  put.resolve();
  await syncPromise;
  await harness.orchestrator.flushPendingRevocations();

  assert.deepEqual(order, [`PUT ${SECRET_A}`, `REVOKE ${SECRET_A}`]);
  assert.equal(harness.getRevocations().length, 0);
});

test('ambiguous PUT failure keeps pending candidate and logout tombstone for later revoke', async () => {
  const timeout = new Error('timeout');
  const harness = makeHarness({
    registerPushToken: async () => {
      throw timeout;
    },
    revokePushToken: async () => {
      throw new Error('offline');
    },
  });
  await assert.rejects(harness.orchestrator.sync(enabled()), timeout);
  assert.equal(harness.getStored().status, 'pending');
  harness.orchestrator.logout();
  await harness.orchestrator.flushPendingRevocations();
  assert.equal(harness.getStored(), null);
  assert.equal(harness.getRevocations().length, 1);
  assert.equal(harness.getRevocations()[0].revocationSecret, SECRET_A);
});

test('failed revoke remains queued and retries on the next AppState-style sync', async () => {
  let attempts = 0;
  const harness = makeHarness({
    revocations: [{ token: 'old-token', revocationSecret: SECRET_A }],
    revokePushToken: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('offline');
    },
  });
  harness.orchestrator.flushPendingRevocations();
  await harness.orchestrator.sync(enabled());
  await harness.orchestrator.flushPendingRevocations();
  assert.equal(attempts >= 2, true);
  assert.equal(harness.getRevocations().length, 0);
});

test('user A pending PUT is serialized before revoke A and PUT B', async () => {
  const putA = deferred();
  const putAStarted = deferred();
  const tokens = ['token-a', 'token-b'];
  const secrets = [SECRET_A, SECRET_B];
  const order = [];
  let secretIndex = 0;
  const harness = makeHarness({
    notifications: {
      IosAuthorizationStatus: { PROVISIONAL: 'provisional' },
      getPermissionsAsync: async () => ({ granted: true }),
      getExpoPushTokenAsync: async () => ({ data: tokens.shift() }),
    },
    generateRevocationSecret: () => secrets[secretIndex++],
    registerPushToken: async ({ token, revocationSecret }) => {
      order.push(`PUT ${token} ${revocationSecret}`);
      if (token === 'token-a') {
        putAStarted.resolve();
        return putA.promise;
      }
    },
    revokePushToken: async (token, secret) => {
      order.push(`REVOKE ${token} ${secret}`);
    },
  });
  const userA = harness.orchestrator.sync(enabled('user-a'));
  await putAStarted.promise;
  const userB = harness.orchestrator.sync(enabled('user-b'));
  putA.resolve();
  await Promise.all([userA, userB]);
  await harness.orchestrator.flushPendingRevocations();
  assert.deepEqual(order, [
    `PUT token-a ${SECRET_A}`,
    `REVOKE token-a ${SECRET_A}`,
    `PUT token-b ${SECRET_B}`,
  ]);
  assert.equal(harness.getStored().userId, 'user-b');
});

test('same pending candidate retries with one generated secret and registered candidate skips', async () => {
  let attempts = 0;
  const harness = makeHarness({
    registerPushToken: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('timeout');
    },
  });
  await assert.rejects(harness.orchestrator.sync(enabled()));
  await harness.orchestrator.sync(enabled());
  await harness.orchestrator.sync(enabled());
  assert.equal(attempts, 2);
  assert.equal(harness.getSecretCalls(), 1);
  assert.equal(harness.registerCalls[0].revocationSecret, SECRET_A);
  assert.equal(harness.registerCalls[1].revocationSecret, SECRET_A);
});

test('same-user AppState replacement coalesces behind one pending PUT', async () => {
  const put = deferred();
  const putStarted = deferred();
  const harness = makeHarness({
    registerPushToken: async () => {
      putStarted.resolve();
      return put.promise;
    },
  });
  const first = harness.orchestrator.sync(enabled());
  await putStarted.promise;
  const replacement = harness.orchestrator.sync(enabled());
  put.resolve();
  await Promise.all([first, replacement]);
  assert.equal(harness.registerCalls.length, 1);
  assert.equal(harness.revokeCalls.length, 0);
  assert.equal(harness.getStored().status, 'registered');
});

test('toggle-off retires locally and uses public revocation without auth state', async () => {
  const harness = makeHarness({
    stored: {
      token: 'registered-token',
      userId: 'user-1',
      revocationSecret: SECRET_A,
      status: 'registered',
    },
  });
  await harness.orchestrator.sync({
    isAuthenticated: true,
    userId: 'user-1',
    pushEnabled: false,
  });
  await harness.orchestrator.flushPendingRevocations();
  assert.equal(harness.getStored(), null);
  assert.equal(harness.revokeCalls.length, 1);
  assert.equal(harness.revokeCalls[0].token, 'registered-token');
  assert.equal(harness.revokeCalls[0].revocationSecret, SECRET_A);
});
