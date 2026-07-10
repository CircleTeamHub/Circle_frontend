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

function loadRegistrar(storageOverride, sharedGlobal) {
  const filePath = path.join(
    process.cwd(),
    'src/features/notifications/services/push-token-registration.ts',
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
    ...(sharedGlobal ? { globalThis: sharedGlobal } : {}),
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
        return {
          storage:
            storageOverride ?? { getString() {}, set() {}, remove() {} },
        };
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
  let legacy = options.legacy ?? null;
  let legacyCleanups = [...(options.legacyCleanups ?? [])];
  const registerCalls = [];
  const revokeCalls = [];
  const diagnostics = [];
  const failures = [];
  let secretCalls = 0;
  let moduleLoads = 0;
  let now = 0;
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
    retireStoredRegistration: () => {
      const active = stored;
      if (!active) return null;
      const exists = revocations.some(
        (item) =>
          item.token === active.token &&
          item.revocationSecret === active.revocationSecret,
      );
      revocations = exists ? revocations : [...revocations, active];
      stored = null;
      return active;
    },
    getLegacyRegistration: () => legacy,
    replaceLegacyRegistration: (value) => {
      legacy = null;
      stored = value;
    },
    retireLegacyRegistration: () => {
      const active = legacy;
      if (!active) return null;
      legacyCleanups = legacyCleanups.some(
        (item) => item.token === active.token && item.userId === active.userId,
      )
        ? legacyCleanups
        : [...legacyCleanups, { ...active, legacy: true }];
      legacy = null;
      return active;
    },
    getLegacyCleanups: () => legacyCleanups,
    removeLegacyCleanup: (value) => {
      legacyCleanups = legacyCleanups.filter(
        (item) => item.token !== value.token || item.userId !== value.userId,
      );
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
    deleteLegacyPushToken: async (token) =>
      options.deleteLegacyPushToken?.(token),
    now: () => now,
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
    getLegacy: () => legacy,
    getLegacyCleanups: () => legacyCleanups,
    advanceTime: (milliseconds) => {
      now += milliseconds;
    },
  };
}

const enabled = (userId = 'user-1') => ({
  isAuthenticated: true,
  userId,
  pushEnabled: true,
});

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  const writes = [];
  return {
    storage: {
      getString: (key) => values.get(key),
      set: (key, value) => {
        writes.push([key, value]);
        values.set(key, value);
      },
      remove: (key) => values.delete(key),
    },
    writes,
    read: (key) => values.get(key),
  };
}

test('v2 retirement atomically writes active null plus tombstone once', () => {
  const active = {
    token: 'atomic-token',
    userId: 'user-1',
    revocationSecret: SECRET_A,
    status: 'pending',
  };
  const memory = memoryStorage({
    'circle-im-push-registration': JSON.stringify({
      version: 2,
      active,
      tombstones: [],
    }),
  });
  const { retireStoredRegistrationAtomically } = loadRegistrar(memory.storage);
  memory.writes.length = 0;
  retireStoredRegistrationAtomically();
  assert.equal(memory.writes.length, 1);
  const persisted = JSON.parse(memory.writes[0][1]);
  assert.equal(persisted.active, null);
  assert.equal(persisted.tombstones[0].revocationSecret, SECRET_A);
});

test('restart migration preserves legacy active and tombstone wins duplicate modern active', () => {
  const legacyMemory = memoryStorage({
    'circle-im-push-registration': JSON.stringify({
      token: 'legacy-token',
      userId: 'legacy-user',
    }),
  });
  const legacyModule = loadRegistrar(legacyMemory.storage);
  const legacyState = legacyModule.readPushState();
  assert.equal(legacyState.version, 2);
  assert.equal(legacyState.active.token, 'legacy-token');
  assert.equal('revocationSecret' in legacyState.active, false);

  const modern = {
    token: 'duplicate-active',
    userId: 'user-1',
    revocationSecret: SECRET_A,
    status: 'registered',
  };
  const duplicateMemory = memoryStorage({
    'circle-im-push-registration': JSON.stringify({
      version: 2,
      active: modern,
      tombstones: [{ token: modern.token, revocationSecret: SECRET_A }],
    }),
  });
  const restarted = loadRegistrar(duplicateMemory.storage).readPushState();
  assert.equal(restarted.active, null);
  assert.equal(restarted.tombstones.length, 1);

  const legacyDuplicateMemory = memoryStorage({
    'circle-im-push-registration': JSON.stringify({
      version: 2,
      active: { token: 'legacy-duplicate', userId: 'legacy-user' },
      tombstones: [
        {
          token: 'legacy-duplicate',
          userId: 'legacy-user',
          legacy: true,
        },
      ],
    }),
  });
  const legacyRestarted = loadRegistrar(
    legacyDuplicateMemory.storage,
  ).readPushState();
  assert.equal(legacyRestarted.active, null);
});

test('Fast Refresh module access reuses one coordinator and stable logout handler', () => {
  const sharedGlobal = {};
  const memory = memoryStorage();
  const firstModule = loadRegistrar(memory.storage, sharedGlobal);
  const secondModule = loadRegistrar(memory.storage, sharedGlobal);
  const first = firstModule.getSharedPushTokenRegistrationOrchestrator();
  const second = secondModule.getSharedPushTokenRegistrationOrchestrator();
  assert.equal(first, second);
  assert.equal(first.logout, second.logout);
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
  await harness.orchestrator.flushPendingRevocations();
  harness.advanceTime(1_000);
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

test('the 51st distinct retirement is preserved without exposing its secret in diagnostics', async () => {
  const existing = Array.from({ length: 50 }, (_, index) => ({
    token: `old-token-${index}`,
    revocationSecret: `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`,
  }));
  const secret51 = '51515151-1111-4111-8111-111111111111';
  const harness = makeHarness({
    revocations: existing,
    stored: {
      token: 'active-token-51',
      userId: 'user-1',
      revocationSecret: secret51,
      status: 'pending',
    },
    revokePushToken: async () => {
      throw new Error('offline');
    },
  });

  harness.orchestrator.logout();
  await harness.orchestrator.flushPendingRevocations();

  assert.equal(harness.getRevocations().length, 51);
  assert.equal(
    harness
      .getRevocations()
      .some((item) => item.token === 'active-token-51' && item.revocationSecret === secret51),
    true,
  );
  assert.equal(harness.diagnostics.length > 0, true);
  assert.equal(JSON.stringify(harness.diagnostics).includes(secret51), false);
});

test('registration pauses at revocation saturation and resumes after a successful flush', async () => {
  const revocations = Array.from({ length: 50 }, (_, index) => ({
    token: `saturated-token-${index}`,
    revocationSecret: `${String(index).padStart(8, '0')}-2222-4222-8222-222222222222`,
  }));
  let revokeFails = true;
  const harness = makeHarness({
    revocations,
    revokePushToken: async () => {
      if (revokeFails) throw new Error('offline');
    },
  });

  await harness.orchestrator.sync(enabled());

  assert.equal(harness.registerCalls.length, 0);
  assert.equal(harness.getStored(), null);
  assert.equal(harness.getRevocations().length, 50);
  assert.equal(harness.diagnostics[0][0], 'push_token_revocation_backpressure');
  assert.equal(JSON.stringify(harness.diagnostics).includes(SECRET_A), false);

  await harness.orchestrator.flushPendingRevocations();
  revokeFails = false;
  harness.advanceTime(1_000);
  await harness.orchestrator.flushPendingRevocations();
  await harness.orchestrator.sync(enabled());

  assert.equal(harness.getRevocations().length, 0);
  assert.equal(harness.registerCalls.length, 1);
  assert.equal(harness.getStored().status, 'registered');
});

test('retiring an exact duplicate tombstone does not grow the unresolved queue', async () => {
  const duplicate = { token: 'duplicate-token', revocationSecret: SECRET_A };
  const harness = makeHarness({
    revocations: [duplicate],
    stored: {
      ...duplicate,
      userId: 'user-1',
      status: 'pending',
    },
    revokePushToken: async () => {
      throw new Error('offline');
    },
  });
  harness.orchestrator.logout();
  await harness.orchestrator.flushPendingRevocations();
  assert.equal(harness.getRevocations().length, 1);
});

test('saturated user replacement retires A before blocking B until flush succeeds', async () => {
  const revocations = Array.from({ length: 50 }, (_, index) => ({
    token: `queued-token-${index}`,
    revocationSecret: `${String(index).padStart(8, '0')}-3333-4333-8333-333333333333`,
  }));
  let revokeFails = true;
  const harness = makeHarness({
    revocations,
    stored: {
      token: 'active-user-a-token',
      userId: 'user-a',
      revocationSecret: SECRET_A,
      status: 'registered',
    },
    token: 'user-b-token',
    secret: SECRET_B,
    revokePushToken: async () => {
      if (revokeFails) throw new Error('offline');
    },
  });

  await harness.orchestrator.sync(enabled('user-b'));

  assert.equal(harness.getStored(), null);
  assert.equal(harness.getRevocations().length, 51);
  assert.equal(
    harness
      .getRevocations()
      .some((item) => item.token === 'active-user-a-token' && item.revocationSecret === SECRET_A),
    true,
  );
  assert.equal(harness.registerCalls.length, 0);

  await harness.orchestrator.flushPendingRevocations();
  revokeFails = false;
  harness.advanceTime(1_000);
  await harness.orchestrator.flushPendingRevocations();
  await harness.orchestrator.sync(enabled('user-b'));

  assert.equal(harness.getRevocations().length, 0);
  assert.equal(harness.registerCalls.length, 1);
  assert.equal(harness.getStored().userId, 'user-b');
  assert.equal(harness.getStored().status, 'registered');
});

test('concurrent flush triggers share one pass and stop after the first failure', async () => {
  const revocations = Array.from({ length: 50 }, (_, index) => ({
    token: `single-flight-${index}`,
    revocationSecret: `${String(index).padStart(8, '0')}-4444-4444-8444-444444444444`,
  }));
  const harness = makeHarness({
    revocations,
    revokePushToken: async () => {
      throw new Error('offline');
    },
  });
  const first = harness.orchestrator.flushPendingRevocations();
  const second = harness.orchestrator.flushPendingRevocations();
  assert.equal(first, second);
  await Promise.all([first, second]);
  assert.equal(harness.revokeCalls.length, 1);
  assert.equal(harness.getRevocations().length, 50);
});

test('same-user legacy active rotates the same token with a real new secret', async () => {
  const harness = makeHarness({
    legacy: { token: 'legacy-token', userId: 'legacy-user' },
    token: 'different-expo-token',
    secret: SECRET_B,
  });
  await harness.orchestrator.sync(enabled('legacy-user'));
  assert.equal(harness.registerCalls[0].token, 'legacy-token');
  assert.equal(harness.registerCalls[0].revocationSecret, SECRET_B);
  assert.equal(harness.getLegacy(), null);
  assert.equal(harness.getStored().status, 'registered');
});

test('signed-out legacy active becomes durable cleanup and retries for that user later', async () => {
  const deleted = [];
  const harness = makeHarness({
    legacy: { token: 'legacy-cleanup', userId: 'legacy-user' },
    deleteLegacyPushToken: async (token) => deleted.push(token),
  });
  await harness.orchestrator.sync({
    isAuthenticated: false,
    userId: '',
    pushEnabled: true,
  });
  assert.equal(harness.getLegacy(), null);
  assert.equal(harness.getLegacyCleanups().length, 1);
  assert.equal(deleted.length, 0);
  await harness.orchestrator.sync(enabled('legacy-user'));
  await Promise.resolve();
  assert.equal(deleted[0], 'legacy-cleanup');
  assert.equal(harness.getLegacyCleanups().length, 0);
});

test('disabled authenticated legacy cleanup is scheduled without awaiting network', async () => {
  const deletion = deferred();
  const harness = makeHarness({
    legacy: { token: 'legacy-disabled', userId: 'legacy-user' },
    deleteLegacyPushToken: async () => deletion.promise,
  });
  await harness.orchestrator.sync({
    isAuthenticated: true,
    userId: 'legacy-user',
    pushEnabled: false,
  });
  assert.equal(harness.getLegacy(), null);
  assert.equal(harness.getLegacyCleanups().length, 1);
  deletion.resolve();
});

test('cross-user legacy active survives B registration and restart until A can clean it', async () => {
  const deletedAsB = [];
  const userB = makeHarness({
    legacy: { token: 'legacy-token-a', userId: 'user-a' },
    token: 'modern-token-b',
    secret: SECRET_B,
    deleteLegacyPushToken: async (token) => deletedAsB.push(token),
  });

  await userB.orchestrator.sync(enabled('user-b'));

  assert.equal(userB.getStored().userId, 'user-b');
  assert.equal(userB.getStored().token, 'modern-token-b');
  assert.equal(userB.getLegacyCleanups().length, 1);
  assert.equal(userB.getLegacyCleanups()[0].token, 'legacy-token-a');
  assert.equal(deletedAsB.length, 0);

  const deletedAsA = [];
  const restarted = makeHarness({
    stored: userB.getStored(),
    legacyCleanups: userB.getLegacyCleanups(),
    token: 'modern-token-a',
    deleteLegacyPushToken: async (token) => deletedAsA.push(token),
  });
  await restarted.orchestrator.sync(enabled('user-b'));
  assert.equal(restarted.getLegacyCleanups().length, 1);
  assert.equal(deletedAsA.length, 0);

  await restarted.orchestrator.sync(enabled('user-a'));
  assert.equal(deletedAsA[0], 'legacy-token-a');
  assert.equal(restarted.getLegacyCleanups().length, 0);
});
