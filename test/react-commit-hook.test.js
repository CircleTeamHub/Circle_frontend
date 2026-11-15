const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

const root = path.join(__dirname, '..');

// React 渲染器只在加载时读一次 __REACT_DEVTOOLS_GLOBAL_HOOK__，晚装一步提交风暴检测就永远收不到回调。
test('the app entry installs the commit hook before anything from expo-router loads', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.main, 'index.ts');

  const imports = [...fs.readFileSync(path.join(root, 'index.ts'), 'utf8').matchAll(/^import\s+'([^']+)';/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual(imports, ['./src/observability/install-react-commit-hook', 'expo-router/entry']);

  const installer = fs.readFileSync(path.join(root, 'src/observability/install-react-commit-hook.ts'), 'utf8');
  const hook = fs.readFileSync(path.join(root, 'src/observability/react-commit-hook.ts'), 'utf8');
  assert.deepEqual([...installer.matchAll(/^import .* from '([^']+)';/gm)].map((match) => match[1]), ['./react-commit-hook']);
  assert.doesNotMatch(hook, /^import /m, 'react-commit-hook must not import anything: it runs before the renderer loads');
});

test('a production hook forwards every commit to subscribers and leaves an existing DevTools hook alone', () => {
  const { installReactCommitHook, subscribeReactCommits } = loadTsModule('src/observability/react-commit-hook.ts');

  const devTarget = {};
  assert.equal(installReactCommitHook(devTarget, true), false);
  assert.equal(devTarget.__REACT_DEVTOOLS_GLOBAL_HOOK__, undefined);

  const existing = { supportsFiber: true };
  const devtoolsTarget = { __REACT_DEVTOOLS_GLOBAL_HOOK__: existing };
  assert.equal(installReactCommitHook(devtoolsTarget, false), false);
  assert.equal(devtoolsTarget.__REACT_DEVTOOLS_GLOBAL_HOOK__, existing);

  const target = {};
  assert.equal(installReactCommitHook(target, false), true);
  const hook = target.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  // 渲染器的接入条件（ReactFabric-prod.js）：未禁用、supportsFiber、inject 返回 rendererID。
  assert.equal(hook.supportsFiber, true);
  assert.notEqual(hook.isDisabled, true);
  assert.equal(typeof hook.inject({}), 'number');

  const seen = [];
  const unsubscribe = subscribeReactCommits((fiberRoot) => seen.push(fiberRoot));
  const fiberRoot = { current: {} };
  hook.onCommitFiberRoot(1, fiberRoot, undefined, false);
  unsubscribe();
  hook.onCommitFiberRoot(1, { current: {} }, undefined, false);
  assert.deepEqual(seen, [fiberRoot]);
});

test('component names and route templates become fingerprint-safe codes', () => {
  const { toStableCode } = loadTsModule('src/observability/report-failure.ts', {
    requireShim: (request) => {
      if (request === './sentry') return { reportError: () => {} };
      if (request === '@/utils/client-diagnostics') return { diagnosticErrorMessage: () => '', logClientDiagnostic: () => {} };
      if (request === '@/utils/redact') return { redactSensitiveFields: (value) => value };
      return require(request);
    },
  });
  assert.equal(toStableCode('Freeze>Suspense'), 'Freeze.Suspense');
  assert.equal(toStableCode('circle/[id]'), 'circle.id');
  assert.equal(toStableCode('(tabs)'), 'tabs');
  assert.equal(toStableCode('[id]'), 'id');
  assert.equal(toStableCode('>>>'), 'unknown');
  assert.match(toStableCode('A'.repeat(100)), /^A{64}$/);
});
