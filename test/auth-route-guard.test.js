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

test('redirect keeps the navigator mounted (no infinite-redirect loop)', () => {
  // Regression: returning <Redirect> alone unmounts the <Stack>, so router.replace
  // can't settle the segment and the guard re-redirects forever ("Maximum update
  // depth exceeded"). The redirect branch must render {children} alongside <Redirect>.
  const source = fs.readFileSync(path.join(process.cwd(), 'app/_layout.tsx'), 'utf8');
  const redirectBranch =
    source.match(/if \(decision\.type === 'redirect'\) \{[\s\S]*?\n  \}/)?.[0] ?? '';

  assert.match(redirectBranch, /\{children\}/);
  assert.ok(
    redirectBranch.indexOf('{children}') <
      redirectBranch.indexOf('<Redirect href={decision.href}'),
    'children (the navigator) must render before/with <Redirect> so it stays mounted',
  );
});

// /invite?code=... 与 /invite/<code>:邀请链接的收件人多半没登录。这条路由不在
// (auth) 分组里,根守卫若把它当受保护路由,就会在页面自己「带邀请码去注册页」的
// 重定向之外再发一个去 login 的重定向,邀请码丢掉 = 拉新链路断在入口。
test('signed-out users reach the invite route instead of being sent to login', () => {
  const { getAuthRouteDecision } = loadPolicy();

  assert.deepEqual(
    plain(getAuthRouteDecision({
      firstSegment: 'invite',
      isAuthenticated: false,
      isLoading: false,
      onboardingRequired: false,
    })),
    { type: 'allow' },
  );

  // 会话还在恢复时也别把它挡在 loading 上:页面自己有 hasHydrated 的等待态。
  assert.deepEqual(
    plain(getAuthRouteDecision({
      firstSegment: 'invite',
      isAuthenticated: false,
      isLoading: true,
      onboardingRequired: false,
    })),
    { type: 'allow' },
  );
});

test('signed-in users are not bounced off the invite route', () => {
  const { getAuthRouteDecision } = loadPolicy();

  // 放行给页面自己处理(它会 Redirect 去邀请中心)——不能像 (auth) 那样弹回消息页。
  assert.deepEqual(
    plain(getAuthRouteDecision({
      firstSegment: 'invite',
      isAuthenticated: true,
      isLoading: false,
      onboardingRequired: false,
    })),
    { type: 'allow' },
  );

  // 但还没完成引导的人照旧先去引导页。
  assert.deepEqual(
    plain(getAuthRouteDecision({
      firstSegment: 'invite',
      isAuthenticated: true,
      isLoading: false,
      onboardingRequired: true,
    })),
    { type: 'redirect', href: '/(onboarding)/profile' },
  );
});
