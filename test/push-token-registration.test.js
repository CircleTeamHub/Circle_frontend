const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

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
        return { useEffect() {}, useRef: (value) => ({ current: value }), useState: (value) => [value, () => {}] };
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
      if (specifier === 'react/jsx-runtime') return {};
      if (specifier === '@/services/api/notifications') {
        return { deletePushToken() {}, registerPushToken() {} };
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

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test('logout removes local registration before remote delete and disables auth retry', async () => {
  const { createPushTokenRegistrationOrchestrator } = loadRegistrar();
  const events = [];
  let stored = { token: 'ExponentPushToken[abc]', userId: 'user-1' };
  const remoteError = new Error('offline');
  const failures = [];
  const orchestrator = createPushTokenRegistrationOrchestrator({
    platform: 'ios',
    appVersion: '1.0.0',
    getProjectId: () => 'project-1',
    getStoredRegistration: () => stored,
    setStoredRegistration: (value) => {
      events.push(['storage', value]);
      stored = value;
    },
    loadNotificationsModule: async () => null,
    registerPushToken: async () => {},
    deletePushToken: async (token, options) => {
      events.push(['delete', token, options]);
      throw remoteError;
    },
    reportFailure: (...args) => failures.push(args),
    reportDiagnostic: () => {},
  });

  await orchestrator.unregisterStoredPushToken({ retryOnAuthError: false });

  assert.deepEqual(events, [
    ['storage', null],
    ['delete', 'ExponentPushToken[abc]', { retryOnAuthError: false }],
  ]);
  assert.equal(stored, null);
  assert.equal(failures.length, 1);
  assert.equal(failures[0][0], 'push_token_unregister_failed');
  assert.equal(failures[0][1], remoteError);
});

test('turning push off unregisters with normal auth retry behavior', async () => {
  const { createPushTokenRegistrationOrchestrator } = loadRegistrar();
  let stored = { token: 'ExponentPushToken[off]', userId: 'user-1' };
  const deletes = [];
  const orchestrator = createPushTokenRegistrationOrchestrator({
    platform: 'ios',
    appVersion: '1.0.0',
    getProjectId: () => 'project-1',
    getStoredRegistration: () => stored,
    setStoredRegistration: (value) => {
      stored = value;
    },
    loadNotificationsModule: async () => null,
    registerPushToken: async () => {},
    deletePushToken: async (...args) => deletes.push(args),
    reportFailure: () => {},
    reportDiagnostic: () => {},
  });

  await orchestrator.sync({
    isAuthenticated: true,
    userId: 'user-1',
    pushEnabled: false,
  });

  assert.equal(stored, null);
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0][0], 'ExponentPushToken[off]');
  assert.equal(Object.keys(deletes[0][1]).length, 0);
});

test('first native run requests notification permission once and registers after provisional grant', async () => {
  const { createPushTokenRegistrationOrchestrator } = loadRegistrar();
  let stored = null;
  const permissionRequests = [];
  const tokenRequests = [];
  const registrations = [];
  const notifications = {
    IosAuthorizationStatus: { PROVISIONAL: 'provisional' },
    getPermissionsAsync: async () => ({
      granted: false,
      canAskAgain: true,
      ios: { status: 'undetermined' },
    }),
    requestPermissionsAsync: async (options) => {
      permissionRequests.push(options);
      return {
        granted: false,
        canAskAgain: true,
        ios: { status: 'provisional' },
      };
    },
    getExpoPushTokenAsync: async (options) => {
      tokenRequests.push(options);
      return { data: 'ExponentPushToken[first-run]' };
    },
  };
  const orchestrator = createPushTokenRegistrationOrchestrator({
    platform: 'ios',
    appVersion: '1.2.3',
    getProjectId: () => 'project-real',
    getStoredRegistration: () => stored,
    setStoredRegistration: (value) => {
      stored = value;
    },
    loadNotificationsModule: async () => notifications,
    registerPushToken: async (input) => registrations.push(input),
    deletePushToken: async () => {},
    reportFailure: () => {},
    reportDiagnostic: () => {},
  });

  await orchestrator.sync({
    isAuthenticated: true,
    userId: 'user-1',
    pushEnabled: true,
  });

  assert.equal(permissionRequests.length, 1);
  assert.equal(permissionRequests[0].ios.allowAlert, true);
  assert.equal(permissionRequests[0].ios.allowBadge, true);
  assert.equal(permissionRequests[0].ios.allowSound, true);
  assert.equal(tokenRequests.length, 1);
  assert.equal(tokenRequests[0].projectId, 'project-real');
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].token, 'ExponentPushToken[first-run]');
  assert.equal(registrations[0].projectId, 'project-real');
  assert.equal(registrations[0].platform, 'ios');
  assert.equal(registrations[0].appVersion, '1.2.3');
  assert.equal(stored.token, 'ExponentPushToken[first-run]');
  assert.equal(stored.userId, 'user-1');
});

test('permanently denied native permission is neither requested nor registered', async () => {
  const { createPushTokenRegistrationOrchestrator } = loadRegistrar();
  let requestCount = 0;
  let tokenCount = 0;
  let registerCount = 0;
  const notifications = {
    IosAuthorizationStatus: { PROVISIONAL: 'provisional' },
    getPermissionsAsync: async () => ({
      granted: false,
      canAskAgain: false,
      ios: { status: 'denied' },
    }),
    requestPermissionsAsync: async () => {
      requestCount += 1;
      return { granted: false, canAskAgain: false };
    },
    getExpoPushTokenAsync: async () => {
      tokenCount += 1;
      return { data: 'should-not-exist' };
    },
  };
  const orchestrator = createPushTokenRegistrationOrchestrator({
    platform: 'ios',
    appVersion: null,
    getProjectId: () => 'project-real',
    getStoredRegistration: () => null,
    setStoredRegistration: () => {},
    loadNotificationsModule: async () => notifications,
    registerPushToken: async () => {
      registerCount += 1;
    },
    deletePushToken: async () => {},
    reportFailure: () => {},
    reportDiagnostic: () => {},
  });

  await orchestrator.sync({
    isAuthenticated: true,
    userId: 'user-denied',
    pushEnabled: true,
  });

  assert.equal(requestCount, 0);
  assert.equal(tokenCount, 0);
  assert.equal(registerCount, 0);
});

test('AppState-style refresh does not reprompt the same user after one session attempt', async () => {
  const { createPushTokenRegistrationOrchestrator } = loadRegistrar();
  let permissionChecks = 0;
  let permissionRequests = 0;
  const notifications = {
    IosAuthorizationStatus: { PROVISIONAL: 'provisional' },
    getPermissionsAsync: async () => {
      permissionChecks += 1;
      return { granted: false, canAskAgain: true };
    },
    requestPermissionsAsync: async () => {
      permissionRequests += 1;
      return { granted: false, canAskAgain: true };
    },
    getExpoPushTokenAsync: async () => ({ data: 'unused' }),
  };
  const orchestrator = createPushTokenRegistrationOrchestrator({
    platform: 'ios',
    appVersion: null,
    getProjectId: () => 'project-real',
    getStoredRegistration: () => null,
    setStoredRegistration: () => {},
    loadNotificationsModule: async () => notifications,
    registerPushToken: async () => {},
    deletePushToken: async () => {},
    reportFailure: () => {},
    reportDiagnostic: () => {},
  });
  const input = {
    isAuthenticated: true,
    userId: 'user-refresh',
    pushEnabled: true,
  };

  await orchestrator.sync(input);
  await orchestrator.sync(input);

  assert.equal(permissionChecks, 2);
  assert.equal(permissionRequests, 1);
});

test('web never loads the native notifications module or registers a push token', async () => {
  const { createPushTokenRegistrationOrchestrator } = loadRegistrar();
  let moduleLoads = 0;
  let registrations = 0;
  const orchestrator = createPushTokenRegistrationOrchestrator({
    platform: 'web',
    appVersion: null,
    getProjectId: () => 'project-real',
    getStoredRegistration: () => null,
    setStoredRegistration: () => {},
    loadNotificationsModule: async () => {
      moduleLoads += 1;
      return {
        IosAuthorizationStatus: { PROVISIONAL: 'provisional' },
        getPermissionsAsync: async () => ({ granted: true }),
        getExpoPushTokenAsync: async () => ({ data: 'web-token' }),
      };
    },
    registerPushToken: async () => {
      registrations += 1;
    },
    deletePushToken: async () => {},
    reportFailure: () => {},
    reportDiagnostic: () => {},
  });

  await orchestrator.sync({
    isAuthenticated: true,
    userId: 'web-user',
    pushEnabled: true,
  });

  assert.equal(moduleLoads, 0);
  assert.equal(registrations, 0);
});

test('missing project ID reports a diagnostic and stops before requesting an Expo token', async () => {
  const { createPushTokenRegistrationOrchestrator } = loadRegistrar();
  let tokenRequests = 0;
  const diagnostics = [];
  const orchestrator = createPushTokenRegistrationOrchestrator({
    platform: 'android',
    appVersion: null,
    getProjectId: () => null,
    getStoredRegistration: () => null,
    setStoredRegistration: () => {},
    loadNotificationsModule: async () => ({
      IosAuthorizationStatus: { PROVISIONAL: 'provisional' },
      getPermissionsAsync: async () => ({ granted: true }),
      getExpoPushTokenAsync: async () => {
        tokenRequests += 1;
        return { data: 'must-not-be-requested' };
      },
    }),
    registerPushToken: async () => {},
    deletePushToken: async () => {},
    reportFailure: () => {},
    reportDiagnostic: (...args) => diagnostics.push(args),
  });

  await orchestrator.sync({
    isAuthenticated: true,
    userId: 'user-no-project',
    pushEnabled: true,
  });

  assert.equal(tokenRequests, 0);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0][0], 'push_token_project_id_missing');
  assert.equal(diagnostics[0][1].platform, 'android');
});

test('logout during a permission request invalidates registration before token lookup', async () => {
  const { createPushTokenRegistrationOrchestrator } = loadRegistrar();
  const permission = deferred();
  const permissionStarted = deferred();
  let stored = null;
  let tokenRequests = 0;
  let registrations = 0;
  const deletes = [];
  const orchestrator = createPushTokenRegistrationOrchestrator({
    platform: 'ios',
    appVersion: null,
    getProjectId: () => 'project-real',
    getStoredRegistration: () => stored,
    setStoredRegistration: (value) => {
      stored = value;
    },
    loadNotificationsModule: async () => ({
      IosAuthorizationStatus: { PROVISIONAL: 'provisional' },
      getPermissionsAsync: async () => ({ granted: false, canAskAgain: true }),
      requestPermissionsAsync: async () => {
        permissionStarted.resolve();
        return permission.promise;
      },
      getExpoPushTokenAsync: async () => {
        tokenRequests += 1;
        return { data: 'must-not-register' };
      },
    }),
    registerPushToken: async () => {
      registrations += 1;
    },
    deletePushToken: async (...args) => deletes.push(args),
    reportFailure: () => {},
    reportDiagnostic: () => {},
  });

  const syncPromise = orchestrator.sync({
    isAuthenticated: true,
    userId: 'permission-race',
    pushEnabled: true,
  });
  await permissionStarted.promise;
  const logoutPromise = orchestrator.logout();
  permission.resolve({ granted: true, canAskAgain: true });
  await Promise.all([logoutPromise, syncPromise]);

  assert.equal(stored, null);
  assert.equal(tokenRequests, 0);
  assert.equal(registrations, 0);
  assert.equal(deletes.length, 0);
});

test('logout during Expo token lookup prevents backend registration without remote cleanup', async () => {
  const { createPushTokenRegistrationOrchestrator } = loadRegistrar();
  const tokenResult = deferred();
  const tokenStarted = deferred();
  let stored = null;
  let registrations = 0;
  const deletes = [];
  const orchestrator = createPushTokenRegistrationOrchestrator({
    platform: 'ios',
    appVersion: null,
    getProjectId: () => 'project-real',
    getStoredRegistration: () => stored,
    setStoredRegistration: (value) => {
      stored = value;
    },
    loadNotificationsModule: async () => ({
      IosAuthorizationStatus: { PROVISIONAL: 'provisional' },
      getPermissionsAsync: async () => ({ granted: true }),
      getExpoPushTokenAsync: async () => {
        tokenStarted.resolve();
        return tokenResult.promise;
      },
    }),
    registerPushToken: async () => {
      registrations += 1;
    },
    deletePushToken: async (...args) => deletes.push(args),
    reportFailure: () => {},
    reportDiagnostic: () => {},
  });

  const syncPromise = orchestrator.sync({
    isAuthenticated: true,
    userId: 'token-race',
    pushEnabled: true,
  });
  await tokenStarted.promise;
  const logoutPromise = orchestrator.logout();
  tokenResult.resolve({ data: 'ExponentPushToken[token-race]' });
  await Promise.all([logoutPromise, syncPromise]);

  assert.equal(stored, null);
  assert.equal(registrations, 0);
  assert.equal(deletes.length, 0);
});

test('logout during backend registration deletes the remotely registered token without persisting it', async () => {
  const { createPushTokenRegistrationOrchestrator } = loadRegistrar();
  const registration = deferred();
  const registrationStarted = deferred();
  let stored = null;
  const deletes = [];
  const orchestrator = createPushTokenRegistrationOrchestrator({
    platform: 'ios',
    appVersion: null,
    getProjectId: () => 'project-real',
    getStoredRegistration: () => stored,
    setStoredRegistration: (value) => {
      stored = value;
    },
    loadNotificationsModule: async () => ({
      IosAuthorizationStatus: { PROVISIONAL: 'provisional' },
      getPermissionsAsync: async () => ({ granted: true }),
      getExpoPushTokenAsync: async () => ({
        data: 'ExponentPushToken[register-race]',
      }),
    }),
    registerPushToken: async () => {
      registrationStarted.resolve();
      return registration.promise;
    },
    deletePushToken: async (...args) => deletes.push(args),
    reportFailure: () => {},
    reportDiagnostic: () => {},
  });

  const syncPromise = orchestrator.sync({
    isAuthenticated: true,
    userId: 'register-race',
    pushEnabled: true,
  });
  await registrationStarted.promise;
  const logoutPromise = orchestrator.logout();
  registration.resolve();
  await Promise.all([logoutPromise, syncPromise]);

  assert.equal(stored, null);
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0][0], 'ExponentPushToken[register-race]');
  assert.equal(deletes[0][1].retryOnAuthError, false);
});

test('logout blocks stale authenticated resync until an unauthenticated transition is observed', async () => {
  const { createPushTokenRegistrationOrchestrator } = loadRegistrar();
  let registrations = 0;
  const orchestrator = createPushTokenRegistrationOrchestrator({
    platform: 'ios',
    appVersion: null,
    getProjectId: () => 'project-real',
    getStoredRegistration: () => null,
    setStoredRegistration: () => {},
    loadNotificationsModule: async () => ({
      IosAuthorizationStatus: { PROVISIONAL: 'provisional' },
      getPermissionsAsync: async () => ({ granted: true }),
      getExpoPushTokenAsync: async () => ({ data: 'ExponentPushToken[new]' }),
    }),
    registerPushToken: async () => {
      registrations += 1;
    },
    deletePushToken: async () => {},
    reportFailure: () => {},
    reportDiagnostic: () => {},
  });
  const authenticated = {
    isAuthenticated: true,
    userId: 'same-user',
    pushEnabled: true,
  };

  await orchestrator.logout();
  await orchestrator.sync(authenticated);
  assert.equal(registrations, 0);

  await orchestrator.sync({
    isAuthenticated: false,
    userId: '',
    pushEnabled: true,
  });
  await orchestrator.sync(authenticated);
  assert.equal(registrations, 1);
});

test('same-user replacement does not let a stale PUT delete the currently desired token', async () => {
  const { createPushTokenRegistrationOrchestrator } = loadRegistrar();
  const firstRegistration = deferred();
  const firstRegistrationStarted = deferred();
  let firstCancelled = false;
  let registerCalls = 0;
  let stored = null;
  const deletes = [];
  const orchestrator = createPushTokenRegistrationOrchestrator({
    platform: 'ios',
    appVersion: null,
    getProjectId: () => 'project-real',
    getStoredRegistration: () => stored,
    setStoredRegistration: (value) => {
      stored = value;
    },
    loadNotificationsModule: async () => ({
      IosAuthorizationStatus: { PROVISIONAL: 'provisional' },
      getPermissionsAsync: async () => ({ granted: true }),
      getExpoPushTokenAsync: async () => ({
        data: 'ExponentPushToken[replacement]',
      }),
    }),
    registerPushToken: async () => {
      registerCalls += 1;
      if (registerCalls === 1) {
        firstRegistrationStarted.resolve();
        return firstRegistration.promise;
      }
    },
    deletePushToken: async (...args) => deletes.push(args),
    reportFailure: () => {},
    reportDiagnostic: () => {},
  });
  const input = {
    isAuthenticated: true,
    userId: 'same-user',
    pushEnabled: true,
  };

  const staleSync = orchestrator.sync({
    ...input,
    isCancelled: () => firstCancelled,
  });
  await firstRegistrationStarted.promise;
  firstCancelled = true;
  await orchestrator.sync(input);
  firstRegistration.resolve();
  await staleSync;

  assert.equal(registerCalls, 2);
  assert.equal(stored.token, 'ExponentPushToken[replacement]');
  assert.equal(stored.userId, 'same-user');
  assert.equal(deletes.length, 0);
});

test('toggle-off during a stale PUT cleans the remote token with normal auth retry', async () => {
  const { createPushTokenRegistrationOrchestrator } = loadRegistrar();
  const registration = deferred();
  const registrationStarted = deferred();
  let cancelled = false;
  let stored = null;
  const deletes = [];
  const orchestrator = createPushTokenRegistrationOrchestrator({
    platform: 'ios',
    appVersion: null,
    getProjectId: () => 'project-real',
    getStoredRegistration: () => stored,
    setStoredRegistration: (value) => {
      stored = value;
    },
    loadNotificationsModule: async () => ({
      IosAuthorizationStatus: { PROVISIONAL: 'provisional' },
      getPermissionsAsync: async () => ({ granted: true }),
      getExpoPushTokenAsync: async () => ({
        data: 'ExponentPushToken[toggle-race]',
      }),
    }),
    registerPushToken: async () => {
      registrationStarted.resolve();
      return registration.promise;
    },
    deletePushToken: async (...args) => deletes.push(args),
    reportFailure: () => {},
    reportDiagnostic: () => {},
  });

  const staleSync = orchestrator.sync({
    isAuthenticated: true,
    userId: 'toggle-user',
    pushEnabled: true,
    isCancelled: () => cancelled,
  });
  await registrationStarted.promise;
  cancelled = true;
  await orchestrator.sync({
    isAuthenticated: true,
    userId: 'toggle-user',
    pushEnabled: false,
  });
  registration.resolve();
  await staleSync;

  assert.equal(stored, null);
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0][0], 'ExponentPushToken[toggle-race]');
  assert.equal(Object.keys(deletes[0][1]).length, 0);
});
