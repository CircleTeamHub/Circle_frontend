const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadAuthStore() {
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
  const context = {
    module: { exports: {} },
    exports: {},
    console,
    require: (request) => {
      if (request === 'zustand') {
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
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return { ...context.module.exports, persistOptions, storageSetCalls };
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

test('authStore unblocks startup but does NOT clearSession when hydration read fails', () => {
  const { useAuthStore, persistOptions } = loadAuthStore();
  const cleared = spyClearSession(useAuthStore);

  const finishHydration = persistOptions.onRehydrateStorage();
  finishHydration(undefined, new Error('secure store unavailable'));

  const state = useAuthStore.getState();
  assert.equal(state.hasHydrated, true);
  assert.equal(state.isLoading, false);
  // 关键回归：读失败绝不能 clearSession —— 否则会把空态写回、删掉磁盘上完好的 token，
  // 让一次瞬时 Keychain 抖动变成永久登出。
  assert.equal(cleared.calls, 0);
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
