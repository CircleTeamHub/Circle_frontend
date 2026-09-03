const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { withObservabilityStubs } = require('./helpers/observability-stubs');

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
    require: withObservabilityStubs((request) => {
      mocks.__onRequire?.(request);
      if (request in mocks) {
        return mocks[request];
      }
      throw new Error(`Unexpected import: ${request}`);
    }),
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
  const clearSessionOptions = [];

  const authState = {
    sessionEpoch: 1,
    accessToken: 'access-a',
    refreshToken: 'refresh-a',
    clearSession: (options) => {
      calls.push('clearSession');
      clearSessionOptions.push(options);
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
    '@/stores/authStore': {
      useAuthStore: authStore,
      persistCurrentAuthState: async () => {
        authStore.setState({});
      },
    },
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
    '@/features/discover/store/use-discover-store': {
      useDiscoverStore: {
        getState: () => ({ reset: () => calls.push('resetDiscover') }),
      },
    },
    '@/stores/userVipStore': {
      invalidateVipLevels: () => calls.push('invalidateVip'),
    },
    '@/utils/client-diagnostics': {
      resetDiagnosticBreadcrumbs: () => calls.push('resetDiagnosticBreadcrumbs'),
    },
  };

  return {
    mocks,
    calls,
    secureAuthRemovals,
    clearSessionOptions,
    authStore,
    authState,
  };
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
  // resetDiagnosticBreadcrumbs 与其他 store reset 同批：诊断面包屑是进程级内存缓冲，
  // 切号不重启，不清就会把上个账号的 id 带进下个账号的错误上报。
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
    'resetDiscover',
    'invalidateVip',
    'resetDiagnosticBreadcrumbs',
    'clearStorage',
  ]);
});

test('clearLocalSession preserves the startup gate until account cleanup settles', async () => {
  const { mocks, clearSessionOptions } = makeBaseMocks();
  const storageClearStarted = deferred();
  const releaseStorageClear = deferred();
  mocks['@/features/messages/store/use-local-unread-store'] = {
    useLocalUnreadStore: {
      getState: () => ({ resetForLogout: () => {} }),
      persist: {
        clearStorage: async () => {
          storageClearStarted.resolve();
          await releaseStorageClear.promise;
        },
      },
    },
  };
  const { clearLocalSession } = loadSessionModule(mocks);

  const clearing = clearLocalSession(undefined, { preserveLoading: true });
  let clearingSettled = false;
  void clearing.then(
    () => {
      clearingSettled = true;
    },
    () => {
      clearingSettled = true;
    },
  );
  await storageClearStarted.promise;

  assert.equal(clearSessionOptions.length, 1);
  assert.equal(clearSessionOptions[0].preserveLoading, true);
  await Promise.resolve();
  assert.equal(clearingSettled, false);

  releaseStorageClear.resolve();
  await clearing;
  assert.equal(clearingSettled, true);
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
    'resetDiscover',
    'invalidateVip',
    'resetDiagnosticBreadcrumbs',
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

test('logout handlers start together and stale async handlers cannot reset a newer session', async () => {
  const { mocks, calls, authState } = makeBaseMocks();
  const { clearLocalSession, registerLogoutHandler } = loadSessionModule(mocks);
  const handlerStarted = deferred();
  const releaseHandler = deferred();

  registerLogoutHandler(async (context) => {
    calls.push('logoutIM:start');
    handlerStarted.resolve();
    await releaseHandler.promise;
    if (!context || context.isCurrent()) {
      calls.push('resetIM');
    }
  });
  registerLogoutHandler(() => {
    calls.push('disconnectRealtime');
  });

  const clearing = clearLocalSession(1);
  await handlerStarted.promise;

  assert.ok(
    calls.includes('disconnectRealtime'),
    'synchronous teardown must run before an earlier async handler settles',
  );

  authState.sessionEpoch = 2;
  calls.push('sessionB');
  releaseHandler.resolve();
  await clearing;

  assert.equal(calls.includes('resetIM'), false);
  assert.equal(calls.filter((call) => call === 'disconnectRealtime').length, 1);
  assert.equal(calls.some((call) => call.startsWith('reset')), false);
});

test('concurrent clears for the same session share one teardown', async () => {
  const { mocks, calls } = makeBaseMocks();
  const { clearLocalSession, registerLogoutHandler } = loadSessionModule(mocks);
  const handlerStarted = deferred();
  const releaseHandler = deferred();
  let handlerCalls = 0;

  registerLogoutHandler(async () => {
    handlerCalls += 1;
    handlerStarted.resolve();
    await releaseHandler.promise;
  });

  const firstClear = clearLocalSession(1);
  await handlerStarted.promise;
  const secondClear = clearLocalSession(1);

  assert.equal(handlerCalls, 1);
  releaseHandler.resolve();
  await Promise.all([firstClear, secondClear]);

  assert.equal(handlerCalls, 1);
  assert.equal(calls.filter((call) => call === 'clearSession').length, 1);
});

test('a clear for a newer session waits for the older teardown and then runs', async () => {
  const { mocks, calls, authState } = makeBaseMocks();
  const { clearLocalSession, registerLogoutHandler } = loadSessionModule(mocks);
  const firstHandlerStarted = deferred();
  const releaseFirstHandler = deferred();
  const handledEpochs = [];

  registerLogoutHandler(async (context) => {
    handledEpochs.push(context.sessionEpoch);
    if (context.sessionEpoch === 1) {
      firstHandlerStarted.resolve();
      await releaseFirstHandler.promise;
    }
  });

  const firstClear = clearLocalSession(1);
  await firstHandlerStarted.promise;

  authState.sessionEpoch = 2;
  const secondClear = clearLocalSession(2);
  assert.deepEqual(handledEpochs, [1]);

  releaseFirstHandler.resolve();
  await Promise.all([firstClear, secondClear]);

  assert.deepEqual(handledEpochs, [1, 2]);
  assert.equal(calls.filter((call) => call === 'clearSession').length, 1);
  assert.equal(authState.sessionEpoch, 3);
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

test('clearLocalSession re-persists a newer session after Zustand void clearStorage finishes', async () => {
  const { mocks, calls, authStore, authState } = makeBaseMocks();
  const persistenceStarted = deferred();
  const releasePersistence = deferred();
  const persistCurrentStarted = deferred();
  const releasePersistCurrent = deferred();
  let persistedAccessToken = 'access-a';
  let firstRemoval = true;
  let storageQueue = Promise.resolve();

  const enqueueStorageMutation = (action) => {
    const next = storageQueue.then(action, action);
    storageQueue = next.catch(() => {});
    return next;
  };

  mocks['@/storage/secure-auth-storage'].secureAuthStorage.removeItem = () =>
    enqueueStorageMutation(async () => {
      calls.push('removeItem:start');
      if (firstRemoval) {
        firstRemoval = false;
        persistenceStarted.resolve();
        await releasePersistence.promise;
      }
      persistedAccessToken = null;
      calls.push('removeItem:done');
    });
  authStore.persist.clearStorage = () => {
    calls.push('clearStorage');
    void mocks['@/storage/secure-auth-storage'].secureAuthStorage.removeItem(
      'circle-im-auth',
    );
  };
  authStore.setState = () => {
    calls.push('persistCurrent');
    void enqueueStorageMutation(async () => {
      persistCurrentStarted.resolve();
      await releasePersistCurrent.promise;
      persistedAccessToken = authState.accessToken;
      calls.push('persistCurrent:done');
    });
  };
  mocks['@/stores/authStore'].persistCurrentAuthState = () => {
    calls.push('persistCurrent:explicit');
    return enqueueStorageMutation(async () => {
      await releasePersistCurrent.promise;
      persistedAccessToken = authState.accessToken;
      calls.push('persistCurrent:explicit:done');
    });
  };
  const { clearLocalSession } = loadSessionModule(mocks);

  const clearing = clearLocalSession(1);
  await persistenceStarted.promise;

  authState.accessToken = 'access-b';
  authState.refreshToken = 'refresh-b';
  authState.sessionEpoch += 1;
  calls.push('sessionB');
  authStore.setState({});
  releasePersistence.resolve();
  await persistCurrentStarted.promise;

  let clearingSettled = false;
  void clearing.then(() => {
    clearingSettled = true;
  });
  await Promise.resolve();
  assert.equal(
    clearingSettled,
    false,
    'clearLocalSession must await the explicit newer-session persistence',
  );

  releasePersistCurrent.resolve();
  await clearing;
  await storageQueue;

  const sessionBIndex = calls.indexOf('sessionB');
  assert.ok(calls.indexOf('persistCurrent') > sessionBIndex);
  assert.ok(
    calls.slice(sessionBIndex + 1).every((call) => !call.startsWith('reset')),
    'B stores must not reset after B starts',
  );
  assert.equal(persistedAccessToken, 'access-b');
  assert.ok(
    calls.indexOf('persistCurrent:explicit:done') >
      calls.lastIndexOf('removeItem:done'),
  );
});

test('relogin during store load: skips in-memory reset but still clears the old account disk key (review P1)', async () => {
  // 新会话在旧会话登出的 store 异步加载期间抢占进来时：
  // - 内存 resetForLogout 必须跳过（否则擦掉新会话的实时 UI 状态）；
  // - 磁盘 clearStorage 仍要执行（否则上一账号的持久化足迹留在共享 MMKV key
  //   上，下次冷启动水合会渗进新会话 —— 正是本 review 指出的泄漏）。
  const { mocks, calls, authState } = makeBaseMocks();
  mocks['@/features/messages/store/use-local-unread-store'] = {
    useLocalUnreadStore: {
      getState: () => ({
        resetForLogout: () => calls.push('resetLocalUnread'),
      }),
      persist: {
        clearStorage: () => calls.push('clearLocalUnreadStorage'),
      },
    },
  };
  mocks.__onRequire = (request) => {
    if (request === '@/features/messages/store/use-local-unread-store') {
      authState.accessToken = 'access-b';
      authState.refreshToken = 'refresh-b';
      authState.sessionEpoch += 1;
      calls.push('sessionB');
    }
  };
  const { clearLocalSession } = loadSessionModule(mocks);

  await clearLocalSession(1);

  assert.ok(calls.includes('sessionB'));
  // 新会话已抢占 —— 不能擦它的内存状态
  assert.equal(calls.includes('resetLocalUnread'), false);
  // 但旧账号的磁盘 key 仍被清掉，杜绝下次水合泄漏
  assert.ok(calls.includes('clearLocalUnreadStorage'));
});

test('relogin mid-load still disk-clears the REMAINING account-scoped stores, not just the one being loaded (review P1)', async () => {
  // 会话在清单中途变化不得 return 掉后面的 store —— 每一个共享 key 都要清。
  const { mocks, calls, authState } = makeBaseMocks();
  mocks['@/features/messages/store/use-local-unread-store'] = {
    useLocalUnreadStore: {
      getState: () => ({
        resetForLogout: () => calls.push('resetLocalUnread'),
      }),
      persist: {
        clearStorage: () => calls.push('clearLocalUnreadStorage'),
      },
    },
  };
  mocks['@/features/chat/store/use-chat-preferences-store'] = {
    useChatPreferencesStore: {
      getState: () => ({
        resetForLogout: () => calls.push('resetChatPreferences'),
      }),
      persist: {
        clearStorage: () => calls.push('clearChatPreferencesStorage'),
      },
    },
  };
  // 在加载第一个账号级 store 时抢占会话
  mocks.__onRequire = (request) => {
    if (request === '@/features/messages/store/use-local-unread-store') {
      authState.sessionEpoch += 1;
      calls.push('sessionB');
    }
  };
  const { clearLocalSession } = loadSessionModule(mocks);

  await clearLocalSession(1);

  assert.ok(calls.includes('sessionB'));
  // 会话已变：两个 store 都不做内存重置
  assert.equal(calls.includes('resetLocalUnread'), false);
  assert.equal(calls.includes('resetChatPreferences'), false);
  // 但两个 store 的磁盘 key 都被清 —— 循环没有在会话变化时提前退出
  assert.ok(calls.includes('clearLocalUnreadStorage'));
  assert.ok(calls.includes('clearChatPreferencesStorage'));
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

test('clearLocalSession does not await background push revocation started by a synchronous logout handler', async () => {
  const { mocks, calls } = makeBaseMocks();
  const { clearLocalSession, registerLogoutHandler } = loadSessionModule(mocks);
  let settleRevocation;
  const hungRevocation = new Promise((resolve) => {
    settleRevocation = resolve;
  });

  registerLogoutHandler(() => {
    calls.push('pushTombstonePersisted');
    void hungRevocation;
  });

  await clearLocalSession();

  assert.equal(calls[0], 'pushTombstonePersisted');
  assert.ok(calls.includes('clearSession'));
  settleRevocation();
});
