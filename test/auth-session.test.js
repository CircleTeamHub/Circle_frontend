const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

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
  const mmkvRemovals = [];

  const authStore = {
    getState: () => ({
      clearSession: () => {
        calls.push('clearSession');
      },
    }),
    persist: {
      clearStorage: async () => {
        calls.push('clearStorage');
      },
    },
  };

  const mocks = {
    '@/stores/authStore': { useAuthStore: authStore },
    '@/storage': {
      mmkvJsonStorage: {
        removeItem: (key) => {
          mmkvRemovals.push(key);
        },
      },
    },
    '@/features/messages/store/use-message-groups-store': {
      useMessageGroupsStore: {
        getState: () => ({ reset: () => calls.push('resetGroups') }),
      },
    },
    '@/stores/friendActivityUnreadStore': {
      useFriendActivityUnreadStore: {
        getState: () => ({ reset: () => calls.push('resetFriendActivityUnread') }),
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

  return { mocks, calls, mmkvRemovals, authStore };
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
    'resetFriendActivityUnread',
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
    'resetFriendActivityUnread',
    'resetTabBadge',
    'resetWalletRealtime',
    'clearStorage',
  ]);
});

test('clearLocalSession falls back to mmkv removeItem when persist.clearStorage rejects (defense in depth: tokens must not remain on disk)', async () => {
  const { mocks, calls, mmkvRemovals, authStore } = makeBaseMocks();
  authStore.persist.clearStorage = async () => {
    calls.push('clearStorage:attempted');
    throw new Error('mmkv write failed');
  };

  const { clearLocalSession } = loadSessionModule(mocks);

  await clearLocalSession();

  assert.ok(
    calls.includes('clearStorage:attempted'),
    'persist.clearStorage should have been attempted'
  );
  assert.deepEqual(
    mmkvRemovals,
    ['circle-im-auth'],
    'fallback mmkv removeItem must be invoked with the auth persist key when persist.clearStorage fails'
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
