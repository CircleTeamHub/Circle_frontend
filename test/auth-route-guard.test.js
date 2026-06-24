const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadPolicy() {
  const filePath = path.join(process.cwd(), 'src/components/app/auth-route-policy.ts');
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
      throw new Error(`Unexpected import: ${request}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('unauthenticated users can only access auth routes', () => {
  const { getAuthRouteDecision } = loadPolicy();

  assert.deepEqual(
    plain(getAuthRouteDecision({
      firstSegment: '(tabs)',
      isAuthenticated: false,
      isLoading: false,
      onboardingRequired: false,
    })),
    { type: 'redirect', href: '/(auth)/login' },
  );
  assert.deepEqual(
    plain(getAuthRouteDecision({
      firstSegment: '(chat)',
      isAuthenticated: false,
      isLoading: false,
      onboardingRequired: false,
    })),
    { type: 'redirect', href: '/(auth)/login' },
  );
  assert.deepEqual(
    plain(getAuthRouteDecision({
      firstSegment: undefined,
      isAuthenticated: false,
      isLoading: false,
      onboardingRequired: false,
    })),
    { type: 'redirect', href: '/(auth)/login' },
  );
  assert.deepEqual(
    plain(getAuthRouteDecision({
      firstSegment: '(auth)',
      isAuthenticated: false,
      isLoading: false,
      onboardingRequired: false,
    })),
    { type: 'allow' },
  );
});

test('protected routes render no interactive app UI while auth state is loading', () => {
  const { getAuthRouteDecision } = loadPolicy();

  assert.deepEqual(
    plain(getAuthRouteDecision({
      firstSegment: '(tabs)',
      isAuthenticated: false,
      isLoading: true,
      onboardingRequired: false,
    })),
    { type: 'loading' },
  );
});

test('logged-in users are kept out of login/register screens', () => {
  const { getAuthRouteDecision } = loadPolicy();

  assert.deepEqual(
    plain(getAuthRouteDecision({
      firstSegment: '(auth)',
      isAuthenticated: true,
      isLoading: false,
      onboardingRequired: false,
    })),
    { type: 'redirect', href: '/(tabs)/messages' },
  );
});

test('newly registered users must finish onboarding before app routes', () => {
  const { getAuthRouteDecision } = loadPolicy();

  assert.deepEqual(
    plain(getAuthRouteDecision({
      firstSegment: '(tabs)',
      isAuthenticated: true,
      isLoading: false,
      onboardingRequired: true,
    })),
    { type: 'redirect', href: '/(onboarding)/profile' },
  );
  assert.deepEqual(
    plain(getAuthRouteDecision({
      firstSegment: '(auth)',
      isAuthenticated: true,
      isLoading: false,
      onboardingRequired: true,
    })),
    { type: 'redirect', href: '/(onboarding)/profile' },
  );
  assert.deepEqual(
    plain(getAuthRouteDecision({
      firstSegment: '(onboarding)',
      isAuthenticated: true,
      isLoading: false,
      onboardingRequired: true,
    })),
    { type: 'allow' },
  );
  assert.deepEqual(
    plain(getAuthRouteDecision({
      firstSegment: '(onboarding)',
      isAuthenticated: true,
      isLoading: false,
      onboardingRequired: false,
    })),
    { type: 'redirect', href: '/(tabs)/messages' },
  );
});

test('onboarding-required state always wins over auth-route fallback', () => {
  const { getAuthRouteDecision } = loadPolicy();

  assert.deepEqual(
    plain(getAuthRouteDecision({
      firstSegment: '(auth)',
      isAuthenticated: false,
      isLoading: false,
      onboardingRequired: true,
    })),
    { type: 'redirect', href: '/(onboarding)/profile' },
  );
  assert.deepEqual(
    plain(getAuthRouteDecision({
      firstSegment: '(onboarding)',
      isAuthenticated: false,
      isLoading: false,
      onboardingRequired: true,
    })),
    { type: 'allow' },
  );
});

test('root layout applies the global auth route guard', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/_layout.tsx'), 'utf8');

  assert.match(source, /useSegments/);
  assert.match(source, /getAuthRouteDecision/);
  assert.match(source, /<AuthRouteGuard>/);
  assert.match(source, /<Redirect href=\{decision\.href\}/);
});
