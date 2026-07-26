const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// client.ts 顶层会 import @/im/listeners 和 @/services/auth/session 用于事件绑定 / teardown
// 注册；测试里我们不关心它们的副作用，全部 no-op 兜底即可。call-site 仍可通过 stubs 覆盖。
const DEFAULT_TS_MODULE_STUBS = {
  '@/im/listeners': {
    bindOpenIMListeners: () => () => {},
    unbindOpenIMListeners: () => {},
  },
  '@/im/token-recovery': {
    registerIMLoginExecutor: () => {},
    registerIMLogoutExecutor: () => {},
    recoverIMSession: async () => false,
    isIMReloginPending: () => false,
  },
  '@/services/auth/session': {
    registerLogoutHandler: () => () => {},
  },
};

function loadTsModule(relativePath, stubs = {}) {
  const filePath = path.join(process.cwd(), relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      baseUrl: process.cwd(),
      paths: {
        '@/*': ['src/*'],
      },
    },
    fileName: filePath,
  }).outputText;

  const mergedStubs = { ...DEFAULT_TS_MODULE_STUBS, ...stubs };
  const context = {
    module: { exports: {} },
    exports: {},
    setTimeout,
    clearTimeout,
    require: (specifier) => {
      if (specifier in mergedStubs) {
        return mergedStubs[specifier];
      }

      return require(specifier);
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });

  return context.module.exports;
}

function createIMSessionHarness({
  connected = false,
  loginStatus = 0,
  nativeUserID = null,
  loginError = null,
  unInitError = null,
} = {}) {
  const calls = [];
  const storeState = { connected };
  const sdk = {
    initSDK: async () => {
      calls.push('init');
    },
    unInitSDK: async () => {
      calls.push('unInit');
      if (unInitError) throw unInitError;
    },
    getLoginStatus: async () => {
      calls.push('getLoginStatus');
      return loginStatus;
    },
    getSelfUserInfo: async () => {
      calls.push('getSelfUserInfo');
      return { userID: nativeUserID };
    },
    login: async ({ userID }) => {
      calls.push(`login:${userID}`);
      if (loginError) throw loginError;
      // 模拟真实 onConnectSuccess：登录成功后长连接就绪，client.ts 的
      // waitForOpenIMConnectionReady 据此返回。
      storeState.connected = true;
    },
    logout: async () => {
      calls.push('logout');
    },
  };
  const client = loadTsModule('src/im/client.ts', {
    '@openim/rn-client-sdk': {
      __esModule: true,
      default: sdk,
      LoginStatus: { Logout: 0, Logged: 3 },
      LogLevel: { Info: 0 },
      SessionType: { Single: 1, Group: 2 },
      ViewType: { History: 0 },
    },
    'react-native-fs': {
      __esModule: true,
      default: {
        DocumentDirectoryPath: '/tmp',
        exists: async () => false,
        mkdir: async () => undefined,
        unlink: async () => undefined,
      },
    },
    'react-native': { Platform: { OS: 'android' } },
    '@/constants/config': {
      OPENIM_API_URL: 'https://im.example.com',
      OPENIM_WS_URL: 'wss://im.example.com',
      OPENIM_LOG_LEVEL: 0,
    },
    '@/stores/imStore': {
      useIMStore: {
        getState: () => ({
          connected: storeState.connected,
          setError: () => undefined,
          setInitialized: () => undefined,
          setCurrentUserID: () => undefined,
          setConnecting: () => undefined,
          setConnected: (value) => {
            storeState.connected = value;
          },
          reset: () => {
            calls.push('reset');
            storeState.connected = false;
          },
        }),
      },
    },
    '@/stores/tabBadgeStore': {
      useTabBadgeStore: {
        getState: () => ({ setMessagesUnread: () => undefined }),
      },
    },
  });

  return { calls, client };
}

// client.ts 顶层现在还会 import @/im/media-uri（本地路径 scheme 处理）；注入真实实现以便 require 解析。
DEFAULT_TS_MODULE_STUBS['@/im/media-uri'] = loadTsModule('src/im/media-uri.ts');
DEFAULT_TS_MODULE_STUBS['@/im/user-id'] = loadTsModule('src/im/user-id.ts');
DEFAULT_TS_MODULE_STUBS['@/im/error-codes'] = loadTsModule('src/im/error-codes.ts');
DEFAULT_TS_MODULE_STUBS['@/im/data-dir'] = loadTsModule('src/im/data-dir.ts');
DEFAULT_TS_MODULE_STUBS['@/storage'] = {
  storage: { getString: () => undefined, set: () => {}, remove: () => {} },
};
DEFAULT_TS_MODULE_STUBS['@/observability/sentry'] = { reportError: () => {} };
DEFAULT_TS_MODULE_STUBS['@/services/api/credit-policy'] = {
  assertCanSendMessage: async () => undefined,
  assertLocalCanSendMessage: () => undefined,
};
DEFAULT_TS_MODULE_STUBS['@/features/chat/utils/voice-forward'] = loadTsModule(
  'src/features/chat/utils/voice-forward.ts',
);

test('ensureOpenIMInitialized excludes the OpenIM data directory from iOS backups', async () => {
  const mkdirCalls = [];
  const initCalls = [];
  const { ensureOpenIMInitialized } = loadTsModule('src/im/client.ts', {
    '@openim/rn-client-sdk': {
      __esModule: true,
      default: {
        initSDK: async (params) => {
          initCalls.push(params);
        },
      },
      LogLevel: { Info: 0 },
      SessionType: { Single: 1, Group: 2 },
      ViewType: { History: 0 },
    },
    'react-native-fs': {
      __esModule: true,
      default: {
        DocumentDirectoryPath: '/tmp/documents',
        mkdir: async (...args) => {
          mkdirCalls.push(args);
        },
      },
    },
    'react-native': {
      Platform: { OS: 'ios' },
    },
    '@/constants/config': {
      OPENIM_API_URL: 'https://im.example.com',
      OPENIM_WS_URL: 'wss://im.example.com',
      OPENIM_LOG_LEVEL: 0,
    },
    '@/stores/imStore': {
      useIMStore: {
        getState: () => ({
          connected: true,
          setError: () => undefined,
          setInitialized: () => undefined,
          setCurrentUserID: () => undefined,
          setConnecting: () => undefined,
          reset: () => undefined,
        }),
      },
    },
    '@/stores/tabBadgeStore': {
      useTabBadgeStore: {
        getState: () => ({
          setMessagesUnread: () => undefined,
        }),
      },
    },
  });

  const initialized = await ensureOpenIMInitialized();

  assert.equal(initialized, true);
  assert.deepEqual(JSON.parse(JSON.stringify(mkdirCalls)), [
    ['/tmp/documents/openim', { NSURLIsExcludedFromBackupKey: true }],
  ]);
  assert.equal(initCalls[0].dataDir, '/tmp/documents/openim');
  assert.equal(initCalls[0].logFilePath, '/tmp/documents/openim');
});

test('ensureOpenIMInitialized aborts when iOS backup exclusion cannot be applied', async () => {
  const initCalls = [];
  const initializedStates = [];
  const mkdirError = new Error('backup exclusion failed');
  const { ensureOpenIMInitialized } = loadTsModule('src/im/client.ts', {
    '@openim/rn-client-sdk': {
      __esModule: true,
      default: {
        initSDK: async (params) => {
          initCalls.push(params);
        },
      },
      LogLevel: { Info: 0 },
      SessionType: { Single: 1, Group: 2 },
      ViewType: { History: 0 },
    },
    'react-native-fs': {
      __esModule: true,
      default: {
        DocumentDirectoryPath: '/tmp/documents',
        mkdir: async () => {
          throw mkdirError;
        },
      },
    },
    'react-native': {
      Platform: { OS: 'ios' },
    },
    '@/constants/config': {
      OPENIM_API_URL: 'https://im.example.com',
      OPENIM_WS_URL: 'wss://im.example.com',
      OPENIM_LOG_LEVEL: 0,
    },
    '@/stores/imStore': {
      useIMStore: {
        getState: () => ({
          connected: false,
          setError: () => undefined,
          setInitialized: (initialized) => initializedStates.push(initialized),
          setCurrentUserID: () => undefined,
          setConnecting: () => undefined,
          reset: () => undefined,
        }),
      },
    },
    '@/stores/tabBadgeStore': {
      useTabBadgeStore: {
        getState: () => ({
          setMessagesUnread: () => undefined,
        }),
      },
    },
  });

  await assert.rejects(ensureOpenIMInitialized(), /backup exclusion failed/);

  assert.equal(initCalls.length, 0);
  assert.deepEqual(initializedStates, [false]);
});

test('login waits for an in-flight OpenIM logout before starting the next session', async () => {
  const logoutGate = deferred();
  const calls = [];
  const storeState = { connected: true };
  const sdk = {
    initSDK: async () => {
      calls.push('init');
    },
    logout: async () => {
      calls.push('logout:start');
      await logoutGate.promise;
      calls.push('logout:done');
    },
    getLoginStatus: async () => {
      calls.push('getLoginStatus');
      return 0;
    },
    login: async ({ userID }) => {
      calls.push(`login:${userID}`);
      storeState.connected = true;
    },
  };
  const { ensureOpenIMInitialized, loginToOpenIM, logoutFromOpenIM } =
    loadTsModule('src/im/client.ts', {
      '@openim/rn-client-sdk': {
        __esModule: true,
        default: sdk,
        LoginStatus: { Logout: 0, Logged: 3 },
        LogLevel: { Info: 0 },
        SessionType: { Single: 1, Group: 2 },
        ViewType: { History: 0 },
      },
      'react-native-fs': {
        __esModule: true,
        default: {
          DocumentDirectoryPath: '/tmp',
          mkdir: async () => undefined,
          exists: async () => false,
          unlink: async () => undefined,
        },
      },
      'react-native': { Platform: { OS: 'ios' } },
      '@/constants/config': {
        OPENIM_API_URL: 'https://im.example.com',
        OPENIM_WS_URL: 'wss://im.example.com',
        OPENIM_LOG_LEVEL: 0,
      },
      '@/stores/imStore': {
        useIMStore: {
          getState: () => ({
            connected: storeState.connected,
            setError: () => undefined,
            setInitialized: () => undefined,
            setCurrentUserID: () => undefined,
            setConnecting: () => undefined,
            setConnected: (connected) => {
              storeState.connected = connected;
            },
            reset: () => {
              storeState.connected = false;
              calls.push('reset');
            },
          }),
        },
      },
      '@/stores/tabBadgeStore': {
        useTabBadgeStore: {
          getState: () => ({ setMessagesUnread: () => undefined }),
        },
      },
    });

  await ensureOpenIMInitialized();
  const logout = logoutFromOpenIM();
  const login = loginToOpenIM('user-b', 'im-token-b');
  await Promise.resolve();

  assert.equal(
    calls.filter((call) => call === 'getLoginStatus').length,
    1,
    'only the in-flight logout may inspect native status before teardown finishes',
  );
  assert.equal(calls.some((call) => call.startsWith('login:')), false);

  logoutGate.resolve();
  await Promise.all([logout, login]);

  assert.ok(calls.lastIndexOf('getLoginStatus') > calls.indexOf('logout:done'));
  assert.ok(calls.indexOf('login:userb') > calls.indexOf('logout:done'));
});

test('logout clears a native Logged session even when the JS store says disconnected', async () => {
  const { calls, client } = createIMSessionHarness({
    connected: false,
    loginStatus: 3,
    nativeUserID: 'usera',
  });

  await client.logoutFromOpenIM();

  assert.ok(calls.includes('getLoginStatus'));
  assert.ok(calls.includes('logout'));
  assert.ok(calls.indexOf('logout') < calls.indexOf('reset'));
});

test('login rebuilds a Logged native session that belongs to another user', async () => {
  const { calls, client } = createIMSessionHarness({
    connected: true,
    loginStatus: 3,
    nativeUserID: 'usera',
  });

  const loggedIn = await client.loginToOpenIM('user-b', 'token-b');

  assert.equal(loggedIn, true);
  assert.deepEqual(
    calls.filter((call) =>
      [
        'init',
        'getLoginStatus',
        'getSelfUserInfo',
        'unInit',
        'reset',
        'login:userb',
      ].includes(call),
    ),
    ['init', 'getLoginStatus', 'getSelfUserInfo', 'unInit', 'reset', 'init', 'login:userb'],
  );
});

test('login aborts when a different native identity cannot be torn down safely', async () => {
  const unInitError = new Error('native database handle is still busy');
  const { calls, client } = createIMSessionHarness({
    connected: true,
    loginStatus: 3,
    nativeUserID: 'usera',
    unInitError,
  });

  await assert.rejects(
    client.loginToOpenIM('user-b', 'token-b'),
    /native database handle is still busy/,
  );

  assert.deepEqual(
    calls.filter((call) =>
      ['init', 'getLoginStatus', 'getSelfUserInfo', 'unInit', 'reset', 'login:userb'].includes(
        call,
      ),
    ),
    ['init', 'getLoginStatus', 'getSelfUserInfo', 'unInit'],
  );
});

test('login does not treat a database initialization failure as benign teardown', async () => {
  const unInitError = new Error(
    'could not initialize database during teardown',
  );
  const { calls, client } = createIMSessionHarness({
    connected: true,
    loginStatus: 3,
    nativeUserID: 'usera',
    unInitError,
  });

  await assert.rejects(
    client.loginToOpenIM('user-b', 'token-b'),
    /could not initialize database during teardown/,
  );
  assert.equal(calls.includes('reset'), false);
  assert.equal(calls.includes('login:userb'), false);
});

test('logout waits for an in-flight login and tears down its late native success', async () => {
  const loginGate = deferred();
  const calls = [];
  let nativeStatus = 0;
  const storeState = { connected: false };
  const sdk = {
    initSDK: async () => {
      calls.push('init');
    },
    unInitSDK: async () => {
      calls.push('unInit');
    },
    getLoginStatus: async () => {
      calls.push(`getLoginStatus:${nativeStatus}`);
      return nativeStatus;
    },
    getSelfUserInfo: async () => {
      calls.push('getSelfUserInfo:usera');
      return { userID: 'usera' };
    },
    login: async ({ userID }) => {
      calls.push(`login:${userID}:start`);
      await loginGate.promise;
      nativeStatus = 3;
      // 登录成功 → onConnectSuccess → 长连接就绪。
      storeState.connected = true;
      calls.push(`login:${userID}:done`);
    },
    logout: async () => {
      calls.push('logout');
      nativeStatus = 0;
    },
  };
  const { loginToOpenIM, logoutFromOpenIM } = loadTsModule('src/im/client.ts', {
    '@openim/rn-client-sdk': {
      __esModule: true,
      default: sdk,
      LoginStatus: { Logout: 0, Logged: 3 },
      LogLevel: { Info: 0 },
      SessionType: { Single: 1, Group: 2 },
      ViewType: { History: 0 },
    },
    'react-native-fs': {
      __esModule: true,
      default: {
        DocumentDirectoryPath: '/tmp',
        mkdir: async () => undefined,
        exists: async () => false,
        unlink: async () => undefined,
      },
    },
    'react-native': { Platform: { OS: 'ios' } },
    '@/constants/config': {
      OPENIM_API_URL: 'https://im.example.com',
      OPENIM_WS_URL: 'wss://im.example.com',
      OPENIM_LOG_LEVEL: 0,
    },
    '@/stores/imStore': {
      useIMStore: {
        getState: () => ({
          connected: storeState.connected,
          setError: () => undefined,
          setInitialized: () => undefined,
          setCurrentUserID: () => undefined,
          setConnecting: () => undefined,
          setConnected: (connected) => {
            storeState.connected = connected;
          },
          reset: () => {
            storeState.connected = false;
            calls.push('reset');
          },
        }),
      },
    },
    '@/stores/tabBadgeStore': {
      useTabBadgeStore: {
        getState: () => ({ setMessagesUnread: () => undefined }),
      },
    },
  });

  const login = loginToOpenIM('user-a', 'token-a');
  while (!calls.includes('login:usera:start')) {
    await Promise.resolve();
  }

  const logout = logoutFromOpenIM();
  await Promise.resolve();
  assert.equal(calls.includes('logout'), false);

  loginGate.resolve();
  await Promise.all([login, logout]);

  assert.ok(calls.indexOf('logout') > calls.indexOf('login:usera:done'));
  assert.equal(nativeStatus, 0);
});

test('logout does not wait forever for a native login that never settles', async () => {
  const calls = [];
  const storeState = { connected: false };
  const sdk = {
    initSDK: async () => {
      calls.push('init');
    },
    unInitSDK: async () => {
      calls.push('unInit');
    },
    getLoginStatus: async () => {
      calls.push('getLoginStatus');
      return 0;
    },
    login: async ({ userID }) => {
      calls.push(`login:${userID}:start`);
      await new Promise(() => {});
    },
    logout: async () => {
      calls.push('logout');
    },
  };
  const { loginToOpenIM, logoutFromOpenIM } = loadTsModule('src/im/client.ts', {
    '@openim/rn-client-sdk': {
      __esModule: true,
      default: sdk,
      LoginStatus: { Logout: 0, Logged: 3 },
      LogLevel: { Info: 0 },
      SessionType: { Single: 1, Group: 2 },
      ViewType: { History: 0 },
    },
    'react-native-fs': {
      __esModule: true,
      default: {
        DocumentDirectoryPath: '/tmp',
        mkdir: async () => undefined,
        exists: async () => false,
        unlink: async () => undefined,
      },
    },
    'react-native': { Platform: { OS: 'ios' } },
    '@/constants/config': {
      OPENIM_API_URL: 'https://im.example.com',
      OPENIM_WS_URL: 'wss://im.example.com',
      OPENIM_LOG_LEVEL: 0,
    },
    '@/stores/imStore': {
      useIMStore: {
        getState: () => ({
          connected: storeState.connected,
          setError: () => undefined,
          setInitialized: () => undefined,
          setCurrentUserID: () => undefined,
          setConnecting: () => undefined,
          setConnected: (connected) => {
            storeState.connected = connected;
          },
          reset: () => {
            storeState.connected = false;
            calls.push('reset');
          },
        }),
      },
    },
    '@/stores/tabBadgeStore': {
      useTabBadgeStore: {
        getState: () => ({ setMessagesUnread: () => undefined }),
      },
    },
  });

  void loginToOpenIM('user-a', 'token-a').catch(() => undefined);
  while (!calls.includes('login:usera:start')) {
    await Promise.resolve();
  }

  const startedAt = Date.now();
  await logoutFromOpenIM();

  assert.ok(Date.now() - startedAt < 1500);
  assert.ok(calls.includes('reset'));
});

test('late login cleanup does not logout a newer native identity', async () => {
  const loginGate = deferred();
  const calls = [];
  let nativeStatus = 0;
  let nativeUserID = null;
  const storeState = { connected: false };
  const sdk = {
    initSDK: async () => {
      calls.push('init');
    },
    unInitSDK: async () => {
      calls.push('unInit');
    },
    getLoginStatus: async () => {
      calls.push(`getLoginStatus:${nativeStatus}`);
      return nativeStatus;
    },
    getSelfUserInfo: async () => {
      calls.push(`getSelfUserInfo:${nativeUserID}`);
      return { userID: nativeUserID };
    },
    login: async ({ userID }) => {
      calls.push(`login:${userID}:start`);
      if (userID === 'usera') {
        await loginGate.promise;
        calls.push(`login:${userID}:late-done`);
        return;
      }
      nativeStatus = 3;
      nativeUserID = userID;
      // 新身份登录成功 → 长连接就绪。
      storeState.connected = true;
      calls.push(`login:${userID}:done`);
    },
    logout: async () => {
      calls.push(`logout:${nativeUserID}`);
      nativeStatus = 0;
      nativeUserID = null;
    },
  };
  const { loginToOpenIM, logoutFromOpenIM } = loadTsModule('src/im/client.ts', {
    '@openim/rn-client-sdk': {
      __esModule: true,
      default: sdk,
      LoginStatus: { Logout: 0, Logged: 3 },
      LogLevel: { Info: 0 },
      SessionType: { Single: 1, Group: 2 },
      ViewType: { History: 0 },
    },
    'react-native-fs': {
      __esModule: true,
      default: {
        DocumentDirectoryPath: '/tmp',
        mkdir: async () => undefined,
        exists: async () => false,
        unlink: async () => undefined,
      },
    },
    'react-native': { Platform: { OS: 'ios' } },
    '@/constants/config': {
      OPENIM_API_URL: 'https://im.example.com',
      OPENIM_WS_URL: 'wss://im.example.com',
      OPENIM_LOG_LEVEL: 0,
    },
    '@/stores/imStore': {
      useIMStore: {
        getState: () => ({
          connected: storeState.connected,
          setError: () => undefined,
          setInitialized: () => undefined,
          setCurrentUserID: () => undefined,
          setConnecting: () => undefined,
          setConnected: (connected) => {
            storeState.connected = connected;
          },
          reset: () => {
            storeState.connected = false;
            calls.push('reset');
          },
        }),
      },
    },
    '@/stores/tabBadgeStore': {
      useTabBadgeStore: {
        getState: () => ({ setMessagesUnread: () => undefined }),
      },
    },
  });

  const staleLogin = loginToOpenIM('user-a', 'token-a');
  while (!calls.includes('login:usera:start')) {
    await Promise.resolve();
  }
  await logoutFromOpenIM();
  await loginToOpenIM('user-b', 'token-b');

  loginGate.resolve();
  await assert.rejects(staleLogin, /completed after logout began/);

  assert.equal(nativeUserID, 'userb');
  assert.equal(calls.includes('logout:userb'), false);
});

test('late duplicate-login success is torn down after logout starts', async () => {
  const loginGate = deferred();
  const duplicateLogin = Object.assign(new Error('User has logged in repeatedly'), {
    code: 10102,
  });
  const calls = [];
  let nativeStatus = 0;
  let nativeUserID = 'usera';
  const storeState = { connected: false };
  const sdk = {
    initSDK: async () => {
      calls.push('init');
    },
    unInitSDK: async () => {
      calls.push('unInit');
    },
    getLoginStatus: async () => {
      calls.push(`getLoginStatus:${nativeStatus}`);
      return nativeStatus;
    },
    getSelfUserInfo: async () => {
      calls.push(`getSelfUserInfo:${nativeUserID}`);
      return { userID: nativeUserID };
    },
    login: async ({ userID }) => {
      calls.push(`login:${userID}:start`);
      await loginGate.promise;
      nativeStatus = 3;
      nativeUserID = userID;
      throw duplicateLogin;
    },
    logout: async () => {
      calls.push(`logout:${nativeUserID}`);
      nativeStatus = 0;
      nativeUserID = null;
    },
  };
  const { loginToOpenIM, logoutFromOpenIM } = loadTsModule('src/im/client.ts', {
    '@openim/rn-client-sdk': {
      __esModule: true,
      default: sdk,
      LoginStatus: { Logout: 0, Logged: 3 },
      LogLevel: { Info: 0 },
      SessionType: { Single: 1, Group: 2 },
      ViewType: { History: 0 },
    },
    'react-native-fs': {
      __esModule: true,
      default: {
        DocumentDirectoryPath: '/tmp',
        mkdir: async () => undefined,
        exists: async () => false,
        unlink: async () => undefined,
      },
    },
    'react-native': { Platform: { OS: 'ios' } },
    '@/constants/config': {
      OPENIM_API_URL: 'https://im.example.com',
      OPENIM_WS_URL: 'wss://im.example.com',
      OPENIM_LOG_LEVEL: 0,
    },
    '@/stores/imStore': {
      useIMStore: {
        getState: () => ({
          connected: storeState.connected,
          setError: () => undefined,
          setInitialized: () => undefined,
          setCurrentUserID: () => undefined,
          setConnecting: () => undefined,
          setConnected: (connected) => {
            storeState.connected = connected;
          },
          reset: () => {
            storeState.connected = false;
            calls.push('reset');
          },
        }),
      },
    },
    '@/stores/tabBadgeStore': {
      useTabBadgeStore: {
        getState: () => ({ setMessagesUnread: () => undefined }),
      },
    },
  });

  const staleLogin = loginToOpenIM('user-a', 'token-a');
  while (!calls.includes('login:usera:start')) {
    await Promise.resolve();
  }
  await logoutFromOpenIM();

  loginGate.resolve();
  await assert.rejects(staleLogin, /completed after logout began/);

  assert.equal(nativeUserID, null);
  assert.ok(calls.includes('logout:usera'));
  assert.equal(storeState.connected, false);
});

test('logout treats a failed status probe before native init as logged out', async () => {
  const calls = [];
  const reportCalls = [];
  const { logoutFromOpenIM } = loadTsModule('src/im/client.ts', {
    '@openim/rn-client-sdk': {
      __esModule: true,
      default: {
        getLoginStatus: async () => {
          calls.push('getLoginStatus');
          throw new Error('Resource initialization incomplete');
        },
        logout: async () => {
          calls.push('logout');
        },
      },
      LoginStatus: { Logout: 0, Logged: 3 },
      LogLevel: { Info: 0 },
      SessionType: { Single: 1, Group: 2 },
      ViewType: { History: 0 },
    },
    'react-native-fs': {
      __esModule: true,
      default: {
        DocumentDirectoryPath: '/tmp',
        mkdir: async () => undefined,
        exists: async () => false,
        unlink: async () => undefined,
      },
    },
    'react-native': { Platform: { OS: 'ios' } },
    '@/constants/config': {
      OPENIM_API_URL: 'https://im.example.com',
      OPENIM_WS_URL: 'wss://im.example.com',
      OPENIM_LOG_LEVEL: 0,
    },
    '@/observability/sentry': {
      reportError: (...args) => reportCalls.push(args),
    },
    '@/stores/imStore': {
      useIMStore: {
        getState: () => ({
          connected: false,
          setError: () => undefined,
          setInitialized: () => undefined,
          setCurrentUserID: () => undefined,
          setConnecting: () => undefined,
          reset: () => {
            calls.push('reset');
          },
        }),
      },
    },
    '@/stores/tabBadgeStore': {
      useTabBadgeStore: {
        getState: () => ({ setMessagesUnread: () => undefined }),
      },
    },
  });

  await logoutFromOpenIM();

  assert.deepEqual(calls, ['getLoginStatus', 'reset']);
  assert.equal(reportCalls.length, 0);
});

test('duplicate login is successful only when the native identity matches', async () => {
  const duplicateLogin = Object.assign(new Error('User has logged in repeatedly'), {
    code: 10102,
  });
  const matching = createIMSessionHarness({
    loginStatus: 0,
    nativeUserID: 'userb',
    loginError: duplicateLogin,
  });
  const mismatched = createIMSessionHarness({
    loginStatus: 0,
    nativeUserID: 'usera',
    loginError: duplicateLogin,
  });

  assert.equal(
    await matching.client.loginToOpenIM('user-b', 'token-b'),
    true,
  );
  await assert.rejects(
    mismatched.client.loginToOpenIM('user-b', 'token-b'),
    /logged in repeatedly/,
  );
});

test('getOrCreateSingleConversation fetches a private conversation and merges it into store', async () => {
  const mergeCalls = [];
  const getOneConversationCalls = [];
  const storeState = {
    connected: true,
  };
  const conversation = {
    conversationID: 'conversation-1',
    conversationType: 1,
    userID: 'user-2',
    groupID: '',
    showName: 'Jimmy',
    faceURL: '',
    recvMsgOpt: 0,
    unreadCount: 0,
    groupAtType: 0,
    latestMsg: '',
    latestMsgSendTime: 0,
    draftText: '',
    draftTextTime: 0,
    burnDuration: 0,
    msgDestructTime: 0,
    isPinned: false,
    isNotInGroup: false,
    isPrivateChat: false,
    isMsgDestruct: false,
    attachedInfo: '',
  };

  const { getOrCreateSingleConversation } = loadTsModule('src/im/client.ts', {
    '@openim/rn-client-sdk': {
      __esModule: true,
      default: {
        initSDK: async () => undefined,
        getOneConversation: async (params) => {
          getOneConversationCalls.push(params);
          return conversation;
        },
      },
      LogLevel: { Info: 0 },
      SessionType: { Single: 1, Group: 2 },
      ViewType: { History: 0 },
    },
    'react-native-fs': {
      __esModule: true,
      default: {
        DocumentDirectoryPath: '/tmp',
        mkdir: async () => undefined,
          exists: async () => false,
          unlink: async () => undefined,
      },
    },
    'react-native': {
      Platform: { OS: 'ios' },
    },
    '@/constants/config': {
      OPENIM_API_URL: 'https://im.example.com',
      OPENIM_WS_URL: 'wss://im.example.com',
      OPENIM_LOG_LEVEL: 0,
    },
    '@/stores/imStore': {
      useIMStore: {
        getState: () => ({
          connected: storeState.connected,
          setError: () => undefined,
          setInitialized: () => undefined,
          setCurrentUserID: () => undefined,
          setConnecting: () => undefined,
          reset: () => undefined,
          setConversations: () => undefined,
          mergeConversations: (items) => mergeCalls.push(items),
        }),
      },
    },
    '@/stores/tabBadgeStore': {
      useTabBadgeStore: {
        getState: () => ({
          setMessagesUnread: () => undefined,
        }),
      },
    },
  });

  const result = await getOrCreateSingleConversation('user-2');

  assert.equal(result.conversationID, 'conversation-1');
  // client.ts 在 SDK 边界跨过去之前会调 toImUserId 去掉 dash（OpenIM v3.8 拒绝
  // 带连字符的 userID）。测试断言要反映这个真实行为。
  assert.deepEqual(
    JSON.parse(JSON.stringify(getOneConversationCalls[0])),
    { sourceID: 'user2', sessionType: 1 },
  );
  assert.equal(mergeCalls.length, 1);
  assert.equal(mergeCalls[0][0].conversationID, 'conversation-1');
});

test('getOrCreateSingleConversation waits until IM connection is ready before reading conversation resources', async () => {
  const getOneConversationCalls = [];
  const storeState = {
    connected: false,
  };

  const { getOrCreateSingleConversation } = loadTsModule('src/im/client.ts', {
    '@openim/rn-client-sdk': {
      __esModule: true,
      default: {
        initSDK: async () => undefined,
        getOneConversation: async (params) => {
          if (!storeState.connected) {
            throw new Error('Resource initialization incomplete');
          }
          getOneConversationCalls.push(params);
          return {
            conversationID: 'conversation-2',
            conversationType: 1,
            userID: 'user-3',
            groupID: '',
            showName: 'Tom',
            faceURL: '',
            recvMsgOpt: 0,
            unreadCount: 0,
            groupAtType: 0,
            latestMsg: '',
            latestMsgSendTime: 0,
            draftText: '',
            draftTextTime: 0,
            burnDuration: 0,
            msgDestructTime: 0,
            isPinned: false,
            isNotInGroup: false,
            isPrivateChat: false,
            isMsgDestruct: false,
            attachedInfo: '',
          };
        },
      },
      LogLevel: { Info: 0 },
      SessionType: { Single: 1, Group: 2 },
      ViewType: { History: 0 },
    },
    'react-native-fs': {
      __esModule: true,
      default: {
        DocumentDirectoryPath: '/tmp',
        mkdir: async () => undefined,
          exists: async () => false,
          unlink: async () => undefined,
      },
    },
    'react-native': {
      Platform: { OS: 'ios' },
    },
    '@/constants/config': {
      OPENIM_API_URL: 'https://im.example.com',
      OPENIM_WS_URL: 'wss://im.example.com',
      OPENIM_LOG_LEVEL: 0,
    },
    '@/stores/imStore': {
      useIMStore: {
        getState: () => ({
          connected: storeState.connected,
          setError: () => undefined,
          setInitialized: () => undefined,
          setCurrentUserID: () => undefined,
          setConnecting: () => undefined,
          reset: () => undefined,
          setConversations: () => undefined,
          mergeConversations: () => undefined,
        }),
      },
    },
    '@/stores/tabBadgeStore': {
      useTabBadgeStore: {
        getState: () => ({
          setMessagesUnread: () => undefined,
        }),
      },
    },
  });

  setTimeout(() => {
    storeState.connected = true;
  }, 10);

  const result = await getOrCreateSingleConversation('user-3');

  assert.equal(result.conversationID, 'conversation-2');
  assert.equal(getOneConversationCalls.length, 1);
});

test('sendTextMessage waits until IM connection is ready before sending', async () => {
  const sdkCalls = [];
  const policyCalls = [];
  const storeState = {
    connected: false,
  };

  const { sendTextMessage } = loadTsModule('src/im/client.ts', {
    '@openim/rn-client-sdk': {
      __esModule: true,
      default: {
        initSDK: async () => undefined,
        createTextMessage: async (text) => {
          sdkCalls.push(['createTextMessage', text]);
          return { clientMsgID: 'client-1', textElem: { content: text } };
        },
        sendMessage: async (params) => {
          if (!storeState.connected) {
            throw new Error('IM connection is not ready');
          }
          sdkCalls.push(['sendMessage', params]);
          return { clientMsgID: 'client-1' };
        },
      },
      LogLevel: { Info: 0 },
      SessionType: { Single: 1, Group: 2 },
      ViewType: { History: 0 },
    },
    'react-native-fs': {
      __esModule: true,
      default: {
        DocumentDirectoryPath: '/tmp',
        mkdir: async () => undefined,
          exists: async () => false,
          unlink: async () => undefined,
      },
    },
    'react-native': {
      Platform: { OS: 'ios' },
    },
    '@/constants/config': {
      OPENIM_API_URL: 'https://im.example.com',
      OPENIM_WS_URL: 'wss://im.example.com',
      OPENIM_LOG_LEVEL: 0,
    },
    '@/services/api/credit-policy': {
      assertLocalCanSendMessage: () => {
        policyCalls.push('local-check');
      },
    },
    '@/stores/imStore': {
      useIMStore: {
        getState: () => ({
          connected: storeState.connected,
          setError: () => undefined,
          setInitialized: () => undefined,
          setCurrentUserID: () => undefined,
          setConnecting: () => undefined,
          reset: () => undefined,
          setConversations: () => undefined,
          mergeConversations: () => undefined,
        }),
      },
    },
    '@/stores/tabBadgeStore': {
      useTabBadgeStore: {
        getState: () => ({
          setMessagesUnread: () => undefined,
        }),
      },
    },
  });

  setTimeout(() => {
    storeState.connected = true;
  }, 10);

  const result = await sendTextMessage({
    sourceID: 'group-1',
    sessionType: 2,
    text: 'hello',
  });

  assert.equal(result.clientMsgID, 'client-1');
  assert.deepEqual(sdkCalls[0], ['createTextMessage', 'hello']);
  assert.equal(policyCalls.length, 1);
  assert.equal(sdkCalls[1][0], 'sendMessage');
  assert.equal(sdkCalls[1][1].groupID, 'group-1');
  assert.equal(sdkCalls[1][1].recvID, '');
});

test('forwardMessage uses the native createForwardMessage primitive (preserves media)', async () => {
  const sdkCalls = [];
  const originalImage = {
    clientMsgID: 'img-1',
    contentType: 102,
    pictureElem: { bigPicture: { url: 'https://cdn.example.com/p.jpg' } },
  };

  const { forwardMessage } = loadTsModule('src/im/client.ts', {
    '@openim/rn-client-sdk': {
      __esModule: true,
      default: {
        initSDK: async () => undefined,
        createForwardMessage: async (message) => {
          sdkCalls.push(['createForwardMessage', message]);
          return { ...message, clientMsgID: 'forward-1' };
        },
        sendMessage: async (params) => {
          sdkCalls.push(['sendMessage', params]);
          return params.message;
        },
      },
      LogLevel: { Info: 0 },
      SessionType: { Single: 1, Group: 2 },
      ViewType: { History: 0 },
    },
    'react-native-fs': {
      __esModule: true,
      default: {
        DocumentDirectoryPath: '/tmp',
        mkdir: async () => undefined,
        exists: async () => false,
        unlink: async () => undefined,
      },
    },
    'react-native': { Platform: { OS: 'ios' } },
    '@/constants/config': {
      OPENIM_API_URL: 'https://im.example.com',
      OPENIM_WS_URL: 'wss://im.example.com',
      OPENIM_LOG_LEVEL: 0,
    },
    '@/stores/imStore': {
      useIMStore: {
        getState: () => ({
          connected: true,
          setError: () => undefined,
          setInitialized: () => undefined,
          setCurrentUserID: () => undefined,
          setConnecting: () => undefined,
          reset: () => undefined,
          setConversations: () => undefined,
          mergeConversations: () => undefined,
        }),
      },
    },
    '@/stores/tabBadgeStore': {
      useTabBadgeStore: { getState: () => ({ setMessagesUnread: () => undefined }) },
    },
  });

  const sent = await forwardMessage({
    sourceID: 'user-9',
    sessionType: 1,
    message: originalImage,
  });

  // The original image item is handed to the SDK forward primitive untouched,
  // so the picture is preserved without re-upload.
  assert.deepEqual(sdkCalls[0], ['createForwardMessage', originalImage]);
  assert.equal(sdkCalls[1][0], 'sendMessage');
  assert.equal(sdkCalls[1][1].recvID, 'user9');
  assert.equal(sdkCalls[1][1].groupID, '');
  assert.equal(sent.clientMsgID, 'forward-1');
});

test('logoutFromOpenIM unbinds OpenIM listeners and a later init rebinds them (C-07)', async () => {
  let bindCalls = 0;
  let unbindCalls = 0;
  const storeState = { connected: true };
  const sdk = {
    initSDK: async () => undefined,
    logout: async () => undefined,
    getLoginStatus: async () => 0,
    login: async () => undefined,
  };
  const { ensureOpenIMInitialized, logoutFromOpenIM } = loadTsModule(
    'src/im/client.ts',
    {
      '@/im/listeners': {
        bindOpenIMListeners: () => {
          bindCalls += 1;
          return () => {};
        },
        unbindOpenIMListeners: () => {
          unbindCalls += 1;
        },
      },
      '@openim/rn-client-sdk': {
        __esModule: true,
        default: sdk,
        LoginStatus: { Logout: 0, Logged: 3 },
        LogLevel: { Info: 0 },
        SessionType: { Single: 1, Group: 2 },
        ViewType: { History: 0 },
      },
      'react-native-fs': {
        __esModule: true,
        default: {
          DocumentDirectoryPath: '/tmp',
          mkdir: async () => undefined,
          exists: async () => false,
          unlink: async () => undefined,
        },
      },
      'react-native': { Platform: { OS: 'ios' } },
      '@/constants/config': {
        OPENIM_API_URL: 'https://im.example.com',
        OPENIM_WS_URL: 'wss://im.example.com',
        OPENIM_LOG_LEVEL: 0,
      },
      '@/stores/imStore': {
        useIMStore: {
          getState: () => ({
            connected: storeState.connected,
            setError: () => undefined,
            setInitialized: () => undefined,
            setCurrentUserID: () => undefined,
            setConnecting: () => undefined,
            setConnected: (connected) => {
              storeState.connected = connected;
            },
            reset: () => {
              storeState.connected = false;
            },
          }),
        },
      },
      '@/stores/tabBadgeStore': {
        useTabBadgeStore: {
          getState: () => ({ setMessagesUnread: () => undefined }),
        },
      },
    },
  );

  await ensureOpenIMInitialized();
  assert.equal(bindCalls, 1);
  assert.equal(unbindCalls, 0);

  // Logout must unbind the SDK listeners so account A's handlers never persist
  // into account B's session.
  await logoutFromOpenIM();
  assert.equal(unbindCalls, 1);

  // A subsequent init rebinds cleanly (initPromise was reset on logout).
  storeState.connected = true;
  await ensureOpenIMInitialized();
  assert.equal(bindCalls, 2);
});

function imageSdkStubs(capture) {
  return {
    '@openim/rn-client-sdk': {
      __esModule: true,
      default: {
        initSDK: async () => undefined,
        getLoginStatus: async () => 3,
        login: async () => undefined,
        createImageMessageByURL: async (args) => {
          capture.args = args;
          return { clientMsgID: 'img-1' };
        },
        sendMessage: async (opts) => opts.message,
      },
      LoginStatus: { Logout: 0, Logged: 3 },
      LogLevel: { Info: 0 },
      SessionType: { Single: 1, Group: 2 },
      ViewType: { History: 0 },
    },
    'react-native-fs': {
      __esModule: true,
      default: {
        DocumentDirectoryPath: '/tmp',
        mkdir: async () => undefined,
        exists: async () => false,
        unlink: async () => undefined,
      },
    },
    'react-native': { Platform: { OS: 'ios' } },
    '@/constants/config': {
      OPENIM_API_URL: 'https://im.example.com',
      OPENIM_WS_URL: 'wss://im.example.com',
      OPENIM_LOG_LEVEL: 0,
    },
    '@/stores/imStore': {
      useIMStore: {
        getState: () => ({
          connected: true,
          setError: () => undefined,
          setInitialized: () => undefined,
          setCurrentUserID: () => undefined,
          setConnecting: () => undefined,
          setConnected: () => undefined,
          reset: () => undefined,
        }),
      },
    },
    '@/stores/tabBadgeStore': {
      useTabBadgeStore: { getState: () => ({ setMessagesUnread: () => undefined }) },
    },
  };
}

test('sendImageMessage uses the thumbnail for snapshotPicture, original for big/source (P9-2)', async () => {
  const capture = {};
  const { sendImageMessage } = loadTsModule(
    'src/im/client.ts',
    imageSdkStubs(capture),
  );

  await sendImageMessage({
    sourceID: 'user-1',
    sessionType: 1,
    url: 'https://cdn.example.com/big.jpg',
    sourcePath: '/local/big.jpg',
    width: 4000,
    height: 3000,
    size: 5_000_000,
    mimeType: 'image/jpeg',
    thumbUrl: 'https://cdn.example.com/thumb.jpg',
    thumbWidth: 512,
    thumbHeight: 384,
  });

  assert.equal(capture.args.bigPicture.url, 'https://cdn.example.com/big.jpg');
  assert.equal(capture.args.sourcePicture.url, 'https://cdn.example.com/big.jpg');
  assert.equal(capture.args.snapshotPicture.url, 'https://cdn.example.com/thumb.jpg');
  assert.equal(capture.args.snapshotPicture.width, 512);
  assert.equal(capture.args.snapshotPicture.height, 384);
});

test('sendImageMessage falls back to the original when no thumbnail is provided (P9-2)', async () => {
  const capture = {};
  const { sendImageMessage } = loadTsModule(
    'src/im/client.ts',
    imageSdkStubs(capture),
  );

  await sendImageMessage({
    sourceID: 'user-1',
    sessionType: 1,
    url: 'https://cdn.example.com/big.jpg',
    sourcePath: '/local/big.jpg',
    mimeType: 'image/jpeg',
  });

  assert.equal(capture.args.snapshotPicture.url, 'https://cdn.example.com/big.jpg');
  assert.equal(capture.args.bigPicture.url, 'https://cdn.example.com/big.jpg');
});
