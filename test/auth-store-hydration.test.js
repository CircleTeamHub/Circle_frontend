const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { withObservabilityStubs } = require('./helpers/observability-stubs');
const { loadTsModule } = require('./helpers/load-ts-module');

function loadAuthStore({ realPersist = false } = {}) {
  const filePath = path.join(process.cwd(), 'src/stores/authStore.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;

  let persistOptions;
  const storageSetCalls = [];
  const reports = [];
  const retained = [];
  let writeFailure = false;
  const context = {
    module: { exports: {} },
    exports: {},
    console,
    require: withObservabilityStubs((request) => {
      if (request === '@/observability/http-diagnostics') return loadTsModule('src/observability/http-diagnostics.ts');
      if (request === '@/observability/session-diagnostics') return {
        recordSessionDiagnostic: (reason, context) => {
          retained.push({ reason, context });
          return '12345678-1234-4234-8234-123456789def';
        },
      };
      if (request === '@/observability/sentry') return {
        reportError: (_error, details) => reports.push(details),
      };
      if (request === 'zustand') {
        if (realPersist) return require('zustand');
        return {
          create: () => (initializer) => {
            const state = {};
            const set = (partial) => {
              Object.assign(
                state,
                typeof partial === 'function' ? partial(state) : partial,
              );
            };
            const get = () => state;
            const api = { setState: set, getState: get };
            Object.assign(state, initializer(set, get, api));

            const store = (selector) => selector(state);
            store.getState = get;
            store.setState = set;
            return store;
          },
        };
      }
      if (request === 'zustand/middleware') {
        if (realPersist) return require('zustand/middleware');
        return {
          createJSONStorage: (getStorage) => getStorage(),
          persist: (config, options) => {
            persistOptions = options;
            return config;
          },
        };
      }
      if (request === '@/storage/secure-auth-storage') {
        return {
          secureAuthStorage: {
            setItem: async (...args) => {
              storageSetCalls.push(args);
              if (writeFailure) throw new Error('fixture storage failure');
            },
          },
        };
      }
      if (request === './authPersist') {
        return {
          AUTH_PERSIST_VERSION: 1,
          migrateAuthPersist: (state) => state,
        };
      }
      if (request === './persisted-user') {
        return { sanitizeUserForPersist: (user) => user };
      }
      if (request === '@/types') return {};
      throw new Error(`Unexpected import: ${request}`);
    }),
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return { ...context.module.exports, persistOptions, storageSetCalls, reports, retained,
    failWrites: () => { writeFailure = true; } };
}

function spyClearSession(useAuthStore) {
  const counter = { calls: 0, args: [] };
  const realClear = useAuthStore.getState().clearSession;
  useAuthStore.setState({
    clearSession: (...args) => {
      counter.calls += 1;
      counter.args.push(args);
      realClear(...args);
    },
  });
  return counter;
}

test('uncertain refresh survives auth persistence and hydration without losing credentials', async () => {
  const first = loadAuthStore();
  first.useAuthStore.getState().setSession({ accessToken: 'saved-access', refreshToken: 'saved-refresh' }, { id: 'saved-user' });
  assert.equal(typeof first.useAuthStore.getState().markRefreshUncertain, 'function');
  await first.useAuthStore.getState().markRefreshUncertain();
  await first.persistCurrentAuthState();
  const envelope = JSON.parse(first.storageSetCalls.at(-1)[1]);
  assert.equal(envelope.state.refreshUncertain, true);
  const next = loadAuthStore();
  next.useAuthStore.setState(next.persistOptions.merge(envelope.state, next.useAuthStore.getState()));
  next.persistOptions.onRehydrateStorage()(next.useAuthStore.getState(), undefined);
  assert.equal(next.useAuthStore.getState().refreshUncertain, true);
  assert.equal(next.useAuthStore.getState().isAuthenticated, true);
  assert.equal(next.useAuthStore.getState().accessToken, 'saved-access');
  assert.equal(next.useAuthStore.getState().refreshToken, 'saved-refresh');
  next.useAuthStore.getState().setTokens({ accessToken: 'fresh-access', refreshToken: 'fresh-refresh' });
  assert.equal(next.useAuthStore.getState().refreshUncertain, false);
});

test('an interrupted rotation restores its durable request correlation and never loses the cached session', async () => {
  const id = '12345678-1234-4234-8234-123456789abc';
  const first = loadAuthStore();
  first.useAuthStore.getState().setSession({ accessToken: 'saved-access', refreshToken: 'saved-refresh' }, { id: 'saved-user' });
  assert.equal(typeof first.useAuthStore.getState().prepareRefresh, 'function');
  await first.useAuthStore.getState().prepareRefresh(id);
  assert.equal(first.useAuthStore.getState().refreshUncertain, false);
  await first.persistCurrentAuthState();
  const envelope = JSON.parse(first.storageSetCalls.at(-1)[1]);
  assert.equal(envelope.state.refreshAttemptId, id);
  const next = loadAuthStore();
  next.useAuthStore.setState(next.persistOptions.merge(envelope.state, next.useAuthStore.getState()));
  next.persistOptions.onRehydrateStorage()(next.useAuthStore.getState(), undefined);
  assert.equal(next.useAuthStore.getState().refreshUncertain, true);
  assert.equal(next.useAuthStore.getState().refreshToken, 'saved-refresh');
  assert.equal(next.retained[0].reason, 'refresh-interrupted');
  assert.equal(next.retained[0].context.clientRequestId, id);
  assert.equal(next.reports[0].kind, 'refreshOutcomeUnknown');
  assert.doesNotMatch(JSON.stringify(next.retained) + JSON.stringify(next.reports), /saved-refresh|saved-access|saved-user/);
  await next.useAuthStore.getState().setTokens({ accessToken: 'next-access', refreshToken: 'next-refresh' });
  assert.equal(next.useAuthStore.getState().refreshAttemptId, null);
});

test('hydration rejects arbitrary persisted refresh correlation strings at its boundary', () => {
  const h = loadAuthStore();
  const state = h.persistOptions.merge({ refreshUncertain: true, refreshAttemptId: 'PRIVATE_CANARY' }, h.useAuthStore.getState());
  assert.equal(state.refreshAttemptId, null);
});

test('marking an uncertain refresh exposes the single real Zustand persistence failure to its caller', async () => {
  const h = loadAuthStore({ realPersist: true });
  h.useAuthStore.getState().setSession({ accessToken: 'saved-access', refreshToken: 'saved-refresh' }, { id: 'saved-user' });
  await h.persistCurrentAuthState();
  const writesBefore = h.storageSetCalls.length;
  h.failWrites();
  await assert.rejects(h.useAuthStore.getState().markRefreshUncertain(), /fixture storage failure/);
  assert.equal(h.storageSetCalls.length - writesBefore, 1);
  assert.equal(h.useAuthStore.getState().refreshUncertain, true);
  assert.equal(h.useAuthStore.getState().isAuthenticated, true);
});

test('a fresh same-account login advances the epoch and resets the uncertain marker', async () => {
  const h = loadAuthStore();
  const state = h.useAuthStore.getState();
  state.setSession({ accessToken: 'old', refreshToken: 'old-refresh' }, { id: 'saved-user' });
  await state.markRefreshUncertain();
  const oldEpoch = state.sessionEpoch;
  state.setSession({ accessToken: 'new', refreshToken: 'new-refresh' }, { id: 'saved-user' });
  assert.equal(state.sessionEpoch, oldEpoch + 1);
  assert.equal(state.refreshUncertain, false);
});

test('authStore unblocks startup but does NOT clearSession when hydration read fails', () => {
  const { useAuthStore, persistOptions, retained } = loadAuthStore();
  const cleared = spyClearSession(useAuthStore);

  const finishHydration = persistOptions.onRehydrateStorage();
  finishHydration(undefined, new Error('secure store unavailable'));

  const state = useAuthStore.getState();
  assert.equal(state.hasHydrated, true);
  assert.equal(state.isLoading, false);
  // 关键回归：读失败绝不能 clearSession —— 否则会把空态写回、删掉磁盘上完好的 token，
  // 让一次瞬时 Keychain 抖动变成永久登出。
  assert.equal(cleared.calls, 0);
  assert.equal(retained[0].reason, 'hydration-read-failed');
});

test('partial credentials with authenticated metadata report before hydration clears the session', () => {
  const { useAuthStore, persistOptions, reports, retained } = loadAuthStore();
  useAuthStore.setState({ isAuthenticated: true, accessToken: 'access-only', refreshToken: null });
  const finishHydration = persistOptions.onRehydrateStorage();
  finishHydration(useAuthStore.getState(), undefined);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].reason, 'hydration-tokens-invalid');
  assert.equal(reports[0].operation, 'session');
  assert.equal(reports[0].kind, 'forcedLogout');
  assert.equal(retained[0].reason, 'hydration-tokens-invalid');
  assert.equal(reports[0].diagnosticId, '12345678-1234-4234-8234-123456789def');
  assert.equal(useAuthStore.getState().accessToken, null);
  assert.doesNotMatch(JSON.stringify(reports), /access-only/);
});

test('empty native startup does not report a forced logout', () => {
  const { useAuthStore, persistOptions, reports } = loadAuthStore();
  persistOptions.onRehydrateStorage()(useAuthStore.getState(), undefined);
  assert.equal(reports.length, 0);
});

test('authStore clears the session when hydration succeeds but tokens are structurally invalid', () => {
  const invalidTokens = [
    { label: 'empty strings', accessToken: '', refreshToken: '' },
    { label: 'null tokens', accessToken: null, refreshToken: null },
    { label: 'access only', accessToken: 'access', refreshToken: null },
    { label: 'refresh only', accessToken: null, refreshToken: 'refresh' },
    { label: 'non-string access', accessToken: 42, refreshToken: 'refresh' },
    { label: 'non-string refresh', accessToken: 'access', refreshToken: {} },
    { label: 'missing tokens', accessToken: undefined, refreshToken: undefined },
  ];

  for (const tokenCase of invalidTokens) {
    const { useAuthStore, persistOptions } = loadAuthStore();
    useAuthStore.setState({
      accessToken: tokenCase.accessToken,
      refreshToken: tokenCase.refreshToken,
      isAuthenticated: true,
    });
    const cleared = spyClearSession(useAuthStore);

    const finishHydration = persistOptions.onRehydrateStorage();
    finishHydration(useAuthStore.getState(), undefined);

    assert.equal(cleared.calls, 1, tokenCase.label);
    assert.equal(cleared.args[0][0].preserveLoading, true, tokenCase.label);
    assert.equal(useAuthStore.getState().isAuthenticated, false, tokenCase.label);
    assert.equal(
      useAuthStore.getState().isLoading,
      true,
      `${tokenCase.label}: startup must stay gated until account-scoped caches are cleared`,
    );
  }
});

test('authStore keeps valid hydrated tokens without clearing', () => {
  const { useAuthStore, persistOptions } = loadAuthStore();
  useAuthStore.setState({ accessToken: 'a', refreshToken: 'r', isAuthenticated: true });
  const cleared = spyClearSession(useAuthStore);

  const finishHydration = persistOptions.onRehydrateStorage();
  finishHydration(useAuthStore.getState(), undefined);

  const state = useAuthStore.getState();
  assert.equal(state.hasHydrated, true);
  assert.equal(cleared.calls, 0);
  assert.equal(state.accessToken, 'a');
  assert.equal(state.isAuthenticated, true);
});

test('authStore advances sessionEpoch on session identity changes', () => {
  const { useAuthStore, persistOptions } = loadAuthStore();
  assert.equal(useAuthStore.getState().sessionEpoch, 0);

  const user = {
    id: 'u1',
    accountId: 'a1',
    uid: 'uid1',
    nickname: 'Alice',
    avatarUrl: null,
    avatarFrame: null,
    avatarFrameAppearance: null,
    cover: null,
    email: null,
    phoneNumber: null,
    wechat: null,
    qq: null,
    whatsup: null,
    persona: null,
    helloWords: null,
    birthday: null,
    gender: 'unset',
    role: 'user',
    status: 'active',
    lastOnline: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    city: null,
    vipLevel: 0,
    creditScore: 0,
    fancyNumber: false,
    displayIcons: [],
  };

  useAuthStore
    .getState()
    .setSession({ accessToken: 'a1', refreshToken: 'r1' }, user);
  assert.equal(useAuthStore.getState().sessionEpoch, 1);

  useAuthStore.getState().setTokens({ accessToken: 'a2', refreshToken: 'r2' });
  assert.equal(useAuthStore.getState().sessionEpoch, 1);

  useAuthStore.getState().clearSession();
  assert.equal(useAuthStore.getState().sessionEpoch, 2);

  const partialized = persistOptions.partialize(useAuthStore.getState());
  assert.equal(partialized.sessionEpoch, undefined);
});

test('persistCurrentAuthState writes an awaitable Zustand-compatible snapshot', async () => {
  const { useAuthStore, persistCurrentAuthState, storageSetCalls } =
    loadAuthStore();
  useAuthStore.setState({
    accessToken: 'access-b',
    refreshToken: 'refresh-b',
    imToken: 'im-b',
    user: { id: 'user-b' },
    isAuthenticated: true,
    onboardingRequired: false,
    sessionEpoch: 7,
  });

  await persistCurrentAuthState();

  assert.equal(storageSetCalls.length, 1);
  assert.equal(storageSetCalls[0][0], 'circle-im-auth');
  const envelope = JSON.parse(storageSetCalls[0][1]);
  assert.equal(envelope.version, 1);
  assert.equal(envelope.state.accessToken, 'access-b');
  assert.equal(envelope.state.refreshToken, 'refresh-b');
  assert.equal(envelope.state.user.id, 'user-b');
  assert.equal(envelope.state.sessionEpoch, undefined);
  assert.equal(envelope.state.isLoading, undefined);
});
