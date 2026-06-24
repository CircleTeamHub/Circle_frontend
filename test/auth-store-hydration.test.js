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
        return { secureAuthStorage: {} };
      }
      if (request === './authPersist') {
        return {
          AUTH_PERSIST_VERSION: 1,
          migrateAuthPersist: (state) => state,
        };
      }
      if (request === '@/types') return {};
      throw new Error(`Unexpected import: ${request}`);
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return { ...context.module.exports, persistOptions };
}

function spyClearSession(useAuthStore) {
  const counter = { calls: 0 };
  const realClear = useAuthStore.getState().clearSession;
  useAuthStore.setState({
    clearSession: () => {
      counter.calls += 1;
      realClear();
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
  const { useAuthStore, persistOptions } = loadAuthStore();
  useAuthStore.setState({ accessToken: '', refreshToken: '', isAuthenticated: true });
  const cleared = spyClearSession(useAuthStore);

  const finishHydration = persistOptions.onRehydrateStorage();
  finishHydration(useAuthStore.getState(), undefined);

  assert.equal(cleared.calls, 1);
  assert.equal(useAuthStore.getState().isAuthenticated, false);
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
