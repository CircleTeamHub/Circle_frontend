const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadUseAuth(fixtures = {}) {
  const filePath = path.join(process.cwd(), 'src/hooks/use-auth.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;

  const router = fixtures.router ?? { replace: (...args) => fixtures.routerCalls.push(args) };
  const authState = {
    setSession: fixtures.setSession ?? (() => {}),
    isAuthenticated: false,
    isLoading: false,
    user: null,
    refreshToken: null,
    accessToken: null,
    imToken: null,
    setUser: () => {},
  };
  const useAuthStore = (selector) => selector(authState);
  useAuthStore.getState = () => authState;

  const modules = {
    react: {
      useCallback: (fn) => fn,
      useEffect: () => {},
      useRef: (value) => ({ current: value }),
      useState: (value) => [value, () => {}],
    },
    'expo-router': {
      useRouter: () => router,
    },
    '@/stores/authStore': {
      useAuthStore,
    },
    '@/stores/knownAccountsStore': {
      useKnownAccountsStore: {
        getState: () => ({
          upsertAccount: fixtures.upsertAccount ?? (() => {}),
          removeAccount: () => {},
        }),
      },
    },
    '@/stores/accountSwitcherStore': {
      useAccountSwitcherStore: {
        getState: () => ({
          close: () => {},
          open: () => {},
        }),
      },
    },
    '@/services/api/auth': {
      fetchCurrentUser: fixtures.fetchCurrentUser ?? (async () => fixtures.user),
      fetchCurrentUserWithToken:
        fixtures.fetchCurrentUserWithToken ?? (async () => fixtures.user),
      login: fixtures.loginRequest ?? (async () => fixtures.tokens),
      loginWithCode: async () => fixtures.tokens,
      logout: async () => {},
      register: async () => fixtures.tokens,
    },
    '@/services/auth/session': {
      clearLocalSession: fixtures.clearLocalSession ?? (async () => {}),
    },
    '@/im/client': {
      loginToOpenIM: fixtures.loginToOpenIM ?? (async () => {}),
      logoutFromOpenIM: fixtures.logoutFromOpenIM ?? (async () => {}),
    },
    '@/services/api/errors': {
      getApiErrorMessage: () => 'request failed',
    },
    '@/features/messages/store/use-message-groups-store': {
      useMessageGroupsStore: {
        getState: () => ({
          load: fixtures.loadMessageGroups ?? (() => {}),
        }),
      },
    },
    '@/utils/retry': {
      retry: async (fn) => fn(),
    },
    '@/features/auth/validation': {
      validateLoginForm: () => null,
      validateLoginCodeForm: () => null,
      validateRegisterForm: () => null,
    },
    '@/i18n': {
      default: { t: (key) => key },
    },
  };

  const context = {
    module: { exports: {} },
    exports: {},
    require: (request) => {
      if (request in modules) {
        return modules[request];
      }
      throw new Error(`Unexpected import: ${request}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

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

test('login success lets the global auth guard perform the auth-route redirect', async () => {
  const routerCalls = [];
  const tokens = {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    imToken: 'im-token',
  };
  const user = {
    id: 'u1',
    email: 'alice@example.com',
    nickname: 'Alice',
  };
  const setSessionCalls = [];
  const { useAuth } = loadUseAuth({
    routerCalls,
    tokens,
    user,
    setSession: (...args) => setSessionCalls.push(args),
  });

  await useAuth().login('alice@example.com', 'password123');

  assert.equal(setSessionCalls.length, 1);
  assert.deepEqual(routerCalls, []);
});

test('auth success session flags map to the expected global route guard redirects', async () => {
  const { getAuthRouteDecision } = loadPolicy();
  const tokens = {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    imToken: 'im-token',
  };
  const user = {
    id: 'u1',
    email: 'alice@example.com',
    nickname: 'Alice',
  };
  const setSessionCalls = [];
  const { useAuth } = loadUseAuth({
    tokens,
    user,
    setSession: (...args) => setSessionCalls.push(args),
  });

  await useAuth().login('alice@example.com', 'password123');
  await useAuth().register('bob@example.com', '123456', 'password123', 'Bob');

  const loginOptions = setSessionCalls[0][2];
  const registerOptions = setSessionCalls[1][2];

  assert.deepEqual(
    JSON.parse(JSON.stringify(getAuthRouteDecision({
      firstSegment: '(auth)',
      isAuthenticated: true,
      isLoading: false,
      onboardingRequired: loginOptions.onboardingRequired,
    }))),
    { type: 'redirect', href: '/(tabs)/messages' },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(getAuthRouteDecision({
      firstSegment: '(auth)',
      isAuthenticated: true,
      isLoading: false,
      onboardingRequired: registerOptions.onboardingRequired,
    }))),
    { type: 'redirect', href: '/(onboarding)/profile' },
  );
});
