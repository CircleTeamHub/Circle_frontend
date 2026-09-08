/**
 * 注册成功但建会话失败 —— 别把「已创建的账号」报成「注册失败」。
 *
 * 真实事故（2026-09-07 本地模拟器）：`POST /auth/register` 返回 201、账号落库，
 * 紧接着的 `GET /auth/me` 因为库缺列连着 500 两次。use-auth 的 register 把
 * registerRequest 和 onAuthSuccess 包在同一个 try 里，于是 UI 显示「注册失败」。
 * 用户当成没注册成功，原样再点一次 —— 撞上自己 1.7 秒前建的账号，得到 409
 * 「该邮箱已注册」。邮箱被自己占掉，密码其实早就生效，但没有任何一屏告诉他。
 *
 * 所以这两种失败必须分开报：
 *   - registerRequest 抛错 → 账号没建出来 → registerFailed（重试是对的）
 *   - onAuthSuccess 抛错   → 账号已经建出来 → 引导去登录（重试是错的）
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { withObservabilityStubs } = require('./helpers/observability-stubs');

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

  // useState 的 setter 在别处的 harness 里是 no-op，这里要能读到 setError 写了什么。
  // submitting 的初值是 false、error 的初值是 null，用初值区分两个 state。
  const errorWrites = [];
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

  const tokens = fixtures.tokens ?? {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
  };
  const user = fixtures.user ?? { id: 'u1', email: 'bob@example.com', nickname: 'Bob' };

  const modules = {
    react: {
      useCallback: (fn) => fn,
      useEffect: () => {},
      useRef: (value) => ({ current: value }),
      useState: (initial) => [
        initial,
        (value) => {
          if (initial === null) errorWrites.push(value);
        },
      ],
    },
    'expo-router': {
      useRouter: () => ({ replace: () => {} }),
    },
    '@/stores/authStore': { useAuthStore },
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
        getState: () => ({ close: () => {}, open: () => {} }),
      },
    },
    '@/services/api/auth': {
      fetchCurrentUser: async () => user,
      fetchCurrentUserWithToken:
        fixtures.fetchCurrentUserWithToken ?? (async () => user),
      login: async () => tokens,
      logout: async () => {},
      register: fixtures.registerRequest ?? (async () => tokens),
    },
    '@/services/auth/session': {
      clearLocalSession:
        fixtures.clearLocalSession ?? (async () => {}),
    },
    '@/services/api/client': {
      isDefinitiveAuthFailure: (error) =>
        Boolean(error) && (error.status === 401 || error.status === 403),
    },
    '@/im/client': {
      loginToOpenIM: async () => {},
      logoutFromOpenIM: async () => {},
    },
    '@/im/token-recovery': {
      recoverIMSession: async () => false,
      getIMRecoveryGeneration: () => 0,
    },
    '@/im/token-errors': { isOpenIMTokenRejectedError: () => false },
    // fallback 原样回传，测试才能看出 register 用的是哪个文案 key。
    '@/services/api/errors': {
      getApiErrorMessage: (_error, fallback) => fallback,
    },
    '@/features/messages/store/use-message-groups-store': {
      useMessageGroupsStore: { getState: () => ({ load: () => {} }) },
    },
    '@/utils/retry': { retry: async (fn) => fn() },
    '@/im/login-retry-pending': {
      markIMLoginRetryPending: () => {},
      clearIMLoginRetryPending: () => {},
      isIMLoginRetryPending: () => false,
    },
    '@/features/auth/validation': {
      validateLoginForm: () => null,
      validateRegisterForm: () => null,
    },
    // esModuleInterop 下 `import i18n from '@/i18n'` 会走 __importDefault，
    // mock 必须自报 __esModule，否则被再包一层、i18n.t 拿不到。
    '@/i18n': { __esModule: true, default: { t: (key) => key } },
  };

  const context = {
    module: { exports: {} },
    exports: {},
    require: withObservabilityStubs((request) => {
      if (request in modules) return modules[request];
      throw new Error(`Unexpected import: ${request}`);
    }),
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return { useAuth: context.module.exports.useAuth, errorWrites };
}

function lastError(errorWrites) {
  const written = errorWrites.filter((value) => value !== null);
  return written.length ? written[written.length - 1] : null;
}

test('注册已成功、只是建会话失败时，不报「注册失败」', async () => {
  const { useAuth, errorWrites } = loadUseAuth({
    // 账号建出来了，token 也发了。
    registerRequest: async () => ({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    }),
    // 但紧接着的 /auth/me 崩了（真实事故里是 Prisma P2022 缺列 → 500）。
    fetchCurrentUserWithToken: async () => {
      const error = new Error('Database error');
      error.status = 500;
      throw error;
    },
  });

  await useAuth().register('bob@example.com', 'password123', 'password123', 'Bob');

  const message = lastError(errorWrites);
  assert.notEqual(
    message,
    'auth.errors.registerFailed',
    '账号已经建出来了，报「注册失败」会诱导用户重试并撞上 409',
  );
  assert.equal(message, 'auth.errors.registerSucceededSessionFailed');
});

test('注册请求本身失败时，仍然报「注册失败」', async () => {
  const { useAuth, errorWrites } = loadUseAuth({
    registerRequest: async () => {
      const error = new Error('该邮箱已注册');
      error.status = 409;
      throw error;
    },
  });

  await useAuth().register('bob@example.com', 'password123', 'password123', 'Bob');

  assert.equal(lastError(errorWrites), 'auth.errors.registerFailed');
});

test('建会话失败后清掉本地半截会话，避免停在既非登录也非登出的状态', async () => {
  let cleared = 0;
  const { useAuth } = loadUseAuth({
    clearLocalSession: async () => {
      cleared += 1;
    },
    fetchCurrentUserWithToken: async () => {
      throw new Error('Database error');
    },
  });

  await useAuth().register('bob@example.com', 'password123', 'password123', 'Bob');

  assert.equal(cleared, 1);
});

test('注册请求本身失败时不必清会话（压根没建过）', async () => {
  let cleared = 0;
  const { useAuth } = loadUseAuth({
    clearLocalSession: async () => {
      cleared += 1;
    },
    registerRequest: async () => {
      throw new Error('boom');
    },
  });

  await useAuth().register('bob@example.com', 'password123', 'password123', 'Bob');

  assert.equal(cleared, 0);
});
