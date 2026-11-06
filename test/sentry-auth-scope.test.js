const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the root's real lifecycle/subscription without rendering native hosts.
function mountRoot(initialState) {
  let state = initialState;
  const listeners = new Set();
  const users = [];
  const resets = [];
  const layoutEffects = [];
  const store = Object.assign(selector => selector(state), {
    getState: () => state,
    subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback); },
  });
  const noop = () => {};
  const fallback = new Proxy({}, { get: () => noop });
  const context = {
    module: { exports: {} }, __DEV__: false, process: { env: {} },
    require: request => {
      if (request === 'react') return { useEffect: noop, useLayoutEffect: effect => layoutEffects.push(effect) };
      if (request === 'react/jsx-runtime') return { jsx: noop, jsxs: noop };
      if (request === 'expo-router') return { useSegments: () => [], useNavigationContainerRef: () => ({}) };
      if (request === '@/stores/authStore') return { useAuthStore: store };
      if (request === '@/stores/upload-progress-store') return { resetUploadProgress: () => resets.push(true) };
      if (request === '@/observability/sentry') return {
        initSentry: noop, wrapWithSentry: component => component, setSentryUserId: user => users.push(user),
      };
      return fallback;
    },
  };
  context.exports = context.module.exports;
  const output = ts.transpileModule(fs.readFileSync('app/_layout.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    fileName: 'app/_layout.tsx',
  }).outputText;
  vm.runInNewContext(output, context);
  context.module.exports.default();
  const cleanups = layoutEffects.map(effect => effect());
  return {
    users, resets,
    change(next) { const previous = state; state = { ...state, ...next }; for (const listener of listeners) listener(state, previous); },
    unmount() { for (const cleanup of cleanups) cleanup?.(); },
  };
}

test('auth scope follows login, profile hydration, account switch and logout synchronously', () => {
  const root = mountRoot({ user: null, isAuthenticated: false, sessionEpoch: 0 });
  assert.deepEqual(root.users, [null]);
  root.change({ isAuthenticated: true, user: { id: 'user-a' }, sessionEpoch: 1 });
  assert.deepEqual(root.users, [null, 'user-a']);
  root.change({ user: { id: 'user-a', nickname: 'changed' } });
  assert.deepEqual(root.users, [null, 'user-a'], 'profile updates do not clear the journey');
  root.change({ user: { id: 'user-b' }, sessionEpoch: 2 });
  assert.deepEqual(root.users, [null, 'user-a', 'user-b']);
  root.change({ isAuthenticated: false, sessionEpoch: 3 });
  assert.equal(root.users.at(-1), null, 'unauthenticated state cannot retain a stale profile id');
  assert.equal(root.resets.length, 3);
  root.unmount();
  root.change({ isAuthenticated: true, user: { id: 'user-c' }, sessionEpoch: 4 });
  assert.equal(root.users.length, 4, 'unmount removes the store subscription');
});

test('an already restored account is associated before descendant passive effects run', () => {
  const root = mountRoot({ user: { id: 'restored-user' }, isAuthenticated: true, sessionEpoch: 0 });
  assert.deepEqual(root.users, ['restored-user']);
  assert.equal(root.resets.length, 0);
  root.unmount();
});
