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

function loadSessionModule(mocks) {
  const filePath = path.join(process.cwd(), 'src/services/auth/session.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;

  const context = {
    module: { exports: {} },
    exports: {},
    require: (request) => {
      mocks.__onRequire?.(request);
      if (request in mocks) {
        return mocks[request];
      }
      throw new Error(`Unexpected import: ${request}`);
    },
    // session.ts gates console.warn on `typeof __DEV__ !== 'undefined' && __DEV__`.
    // Leave __DEV__ undefined so dev logs stay silent during tests.
    console: { warn: () => {} },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

function makeBaseMocks() {
  const calls = [];
  const secureAuthRemovals = [];

  const authState = {
    sessionEpoch: 1,
    accessToken: 'access-a',
    refreshToken: 'refresh-a',
    clearSession: () => {
      calls.push('clearSession');
      authState.sessionEpoch += 1;
    },
  };
  const authStore = {
    getState: () => authState,
    setState: () => {
      calls.push('persistCurrent');
    },
    persist: {
      clearStorage: async () => {
        calls.push('clearStorage');
      },
    },
  };

  const mocks = {
    '@/stores/authStore': { useAuthStore: authStore },
    '@/storage/secure-auth-storage': {
      secureAuthStorage: {
        removeItem: (key) => {
          secureAuthRemovals.push(key);
        },
      },
    },
    '@/features/messages/store/use-message-groups-store': {
      useMessageGroupsStore: {
        getState: () => ({ reset: () => calls.push('resetGroups') }),
      },
    },
    '@/features/discover/store/use-circles-store': {
      useCirclesStore: {
        getState: () => ({ reset: () => calls.push('resetCircles') }),
      },
    },
    '@/stores/friendActivityUnreadStore': {
      useFriendActivityUnreadStore: {
        getState: () => ({ reset: () => calls.push('resetFriendActivityUnread') }),
      },
    },
    '@/stores/friendRemarkStore': {
      useFriendRemarkStore: {
        getState: () => ({ reset: () => calls.push('resetFriendRemark') }),
      },
    },
    '@/stores/tabBadgeStore': {
      useTabBadgeStore: {
        getState: () => ({ reset: () => calls.push('resetTabBadge') }),
      },
    },
    '@/stores/walletRealtimeStore': {
      useWalletRealtimeStore: {
        getState: () => ({ reset: () => calls.push('resetWalletRealtime') }),
      },
    },
  };

  return { mocks, calls, secureAuthRemovals, authStore, authState };
}

test('clearLocalSession runs registered teardown handlers, then resets stores auth-first, then clears persistence', async () => {
  const { mocks, calls } = makeBaseMocks();
  const { clearLocalSession, registerLogoutHandler } = loadSessionModule(mocks);

  registerLogoutHandler(async () => {
    calls.push('disconnectRealtime');
  });
  registerLogoutHandler(async () => {
    calls.push('logoutIM');
  });

  await clearLocalSession();

  // Handlers fire first (in registration order). Auth is cleared BEFORE dependent
  // stores so subscribers see "logged out" before "data is empty", preventing
  // mid-logout refetches. Persist storage is cleared last.
  assert.deepEqual(calls, [
    'disconnectRealtime',
    'logoutIM',
    'clearSession',
    'resetGroups',
    'resetCircles',
    'resetFriendActivityUnread',
    'resetFriendRemark',
    'resetTabBadge',
    'resetWalletRealtime',
    'clearStorage',
  ]);
});

test('session module avoids a static message-groups import that cycles back into apiClient', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/services/auth/session.ts'),
    'utf8',
  );

  assert.doesNotMatch(
    source,
    /import\s+\{\s*useMessageGroupsStore\s*\}\s+from\s+['"]@\/features\/messages\/store\/use-message-groups-store['"]/,
  );
  assert.match(
    source,
    /import\(\s*['"]@\/features\/messages\/store\/use-message-groups-store['"]\s*\)/,
  );
});

test('clearLocalSession still clears local state when a teardown handler throws', async () => {
  const { mocks, calls } = makeBaseMocks();
  const { clearLocalSession, registerLogoutHandler } = loadSessionModule(mocks);

  registerLogoutHandler(() => {
    calls.push('disconnectRealtime');
  });
  registerLogoutHandler(async () => {
    calls.push('logoutIM');
    throw new Error('sdk logout failed');
  });

  await clearLocalSession();

  assert.deepEqual(calls, [
    'disconnectRealtime',
    'logoutIM',
    'clearSession',
    'resetGroups',
    'resetCircles',
    'resetFriendActivityUnread',
    'resetFriendRemark',
    'resetTabBadge',
    'resetWalletRealtime',
    'clearStorage',
  ]);
});

test('guarded clearLocalSession skips session clearing when ownership changes during async teardown', async () => {
  const { mocks, calls, secureAuthRemovals, authState } = makeBaseMocks();
  const { clearLocalSession, registerLogoutHandler } = loadSessionModule(mocks);
  const handlerStarted = deferred();
  const releaseHandler = deferred();

  registerLogoutHandler(async () => {
    calls.push('disconnectRealtime');
    handlerStarted.resolve();
    await releaseHandler.promise;
  });

  const clearing = clearLocalSession(1);
  await handlerStarted.promise;
  authState.sessionEpoch = 2;
  releaseHandler.resolve();
  await clearing;

  assert.deepEqual(calls, ['disconnectRealtime']);
  assert.deepEqual(secureAuthRemovals, []);
});

test('guarded clearLocalSession skips all resets when the session changes during module loading', async () => {
  const { mocks, calls, authState } = makeBaseMocks();
  mocks.__onRequire = (request) => {
    if (request === '@/features/messages/store/use-message-groups-store') {
      authState.accessToken = 'access-b';
      authState.refreshToken = 'refresh-b';
      authState.sessionEpoch += 1;
    }
  };
  const { clearLocalSession } = loadSessionModule(mocks);

  await clearLocalSession(1);

  assert.deepEqual(calls, []);
  assert.equal(authState.accessToken, 'access-b');
  assert.equal(authState.refreshToken, 'refresh-b');
});

test('clearLocalSession re-persists a newer session after async persistence clearing finishes', async () => {
  const { mocks, calls, authStore, authState } = makeBaseMocks();
  const persistenceStarted = deferred();
  const releasePersistence = deferred();
  authStore.persist.clearStorage = async () => {
    calls.push('clearStorage:start');
    persistenceStarted.resolve();
    await releasePersistence.promise;
    calls.push('clearStorage:done');
  };
  const { clearLocalSession } = loadSessionModule(mocks);

  const clearing = clearLocalSession(1);
  await persistenceStarted.promise;

  authState.accessToken = 'access-b';
  authState.refreshToken = 'refresh-b';
  authState.sessionEpoch += 1;
  calls.push('sessionB');
  releasePersistence.resolve();
  await clearing;

  const sessionBIndex = calls.indexOf('sessionB');
  assert.ok(calls.indexOf('persistCurrent') > sessionBIndex);
  assert.ok(
    calls.slice(sessionBIndex + 1).every((call) => !call.startsWith('reset')),
    'B stores must not reset after B starts',
  );
});

test('clearLocalSession falls back to secure auth removeItem when persist.clearStorage rejects (defense in depth: tokens must not remain on disk)', async () => {
  const { mocks, calls, secureAuthRemovals, authStore } = makeBaseMocks();
  authStore.persist.clearStorage = async () => {
    calls.push('clearStorage:attempted');
    throw new Error('secure storage delete failed');
  };

  const { clearLocalSession } = loadSessionModule(mocks);

  await clearLocalSession();

  assert.ok(
    calls.includes('clearStorage:attempted'),
    'persist.clearStorage should have been attempted'
  );
  assert.deepEqual(
    secureAuthRemovals,
    ['circle-im-auth'],
    'fallback secure auth removeItem must be invoked with the auth persist key when persist.clearStorage fails'
  );
});

test('registerLogoutHandler returns an unregister function that removes the handler', async () => {
  const { mocks, calls } = makeBaseMocks();
  const { clearLocalSession, registerLogoutHandler } = loadSessionModule(mocks);

  const unregister = registerLogoutHandler(() => {
    calls.push('shouldBeRemoved');
  });
  registerLogoutHandler(() => {
    calls.push('keeper');
  });
  unregister();

  await clearLocalSession();

  assert.ok(
    !calls.includes('shouldBeRemoved'),
    'unregistered handler should not run'
  );
  assert.ok(calls.includes('keeper'), 'other handlers should still run');
});

test('registerLogoutHandler is idempotent for the same handler reference (HMR safety)', async () => {
  const { mocks, calls } = makeBaseMocks();
  const { clearLocalSession, registerLogoutHandler } = loadSessionModule(mocks);

  const handler = () => calls.push('once');
  registerLogoutHandler(handler);
  registerLogoutHandler(handler);
  registerLogoutHandler(handler);

  await clearLocalSession();

  const ran = calls.filter((c) => c === 'once').length;
  assert.equal(ran, 1, 'duplicate registrations of the same handler must collapse');
});
