const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

// ---------------------------------------------------------------------------
// 行为测试：src/im/token-recovery.ts（依赖全部 shim，跑真实模块逻辑）
// ---------------------------------------------------------------------------

function buildHarness({
  fetchImTokenImpl,
  authState: authOverrides = {},
  executor,
} = {}) {
  const calls = {
    fetchImToken: 0,
    setImToken: [],
    clearLocalSession: 0,
    routerReplace: [],
    imSetError: [],
    executor: [],
  };

  const authState = {
    user: { id: 'user-1' },
    accessToken: 'access-a',
    onboardingRequired: false,
    sessionEpoch: 1,
    setImToken: (token) => {
      calls.setImToken.push(token);
    },
    ...authOverrides,
  };

  const imState = {
    setError: (message) => {
      calls.imSetError.push(message);
    },
  };

  const shims = {
    'expo-router': {
      router: {
        replace: (route) => {
          calls.routerReplace.push(route);
        },
      },
    },
    '@/i18n': {
      default: { t: (key) => key },
      __esModule: true,
    },
    '@/services/api/auth': {
      fetchImToken: async () => {
        calls.fetchImToken += 1;
        if (!fetchImTokenImpl) return 'fresh-token';
        return fetchImTokenImpl(calls.fetchImToken);
      },
    },
    '@/services/api/client': {
      // 与真实实现同语义：401/403 为「服务端明确否认」
      isDefinitiveAuthFailure: (error) =>
        error && (error.status === 401 || error.status === 403),
    },
    '@/services/auth/session': {
      clearLocalSession: async () => {
        calls.clearLocalSession += 1;
      },
    },
    '@/stores/authStore': {
      useAuthStore: { getState: () => authState },
    },
    '@/stores/imStore': {
      useIMStore: { getState: () => imState },
    },
  };

  const mod = loadTsModule('src/im/token-recovery.ts', {
    requireShim: (specifier) => {
      if (shims[specifier]) return shims[specifier];
      throw new Error(`unexpected import in token-recovery: ${specifier}`);
    },
    context: { __DEV__: false, console },
  });

  if (executor !== null) {
    mod.registerIMLoginExecutor(
      executor ??
        (async (userId, token) => {
          calls.executor.push([userId, token]);
          return true;
        }),
    );
  }

  return { mod, calls, authState };
}

test('token recovery: 换新 token → 写回 store → 原地重登，不动业务会话', async () => {
  const { mod, calls } = buildHarness();

  const recovered = await mod.recoverIMSession();

  assert.equal(recovered, true);
  assert.equal(calls.fetchImToken, 1);
  assert.deepEqual(calls.setImToken, ['fresh-token']);
  assert.deepEqual(calls.executor, [['user-1', 'fresh-token']]);
  assert.equal(calls.clearLocalSession, 0);
  assert.deepEqual(calls.routerReplace, []);
  assert.equal(mod.isIMReloginPending(), false);
});

test('token recovery: 瞬时失败（503/网络）保住会话，只记欠账', async () => {
  const { mod, calls } = buildHarness({
    fetchImTokenImpl: async () => {
      const error = new Error('service unavailable');
      error.status = 503;
      throw error;
    },
  });

  const recovered = await mod.recoverIMSession();

  assert.equal(recovered, false);
  assert.equal(calls.clearLocalSession, 0);
  assert.deepEqual(calls.routerReplace, []);
  assert.equal(mod.isIMReloginPending(), true);

  // 欠账可被下一次调用消费（回前台补登路径）
  const secondTry = await mod.recoverIMSession();
  assert.equal(secondTry, false); // fetch 仍失败（同一 impl）
  assert.equal(calls.fetchImToken, 2);
});

test('token recovery: 业务凭证被明确拒绝(401)才清 session 跳登录页', async () => {
  const { mod, calls } = buildHarness({
    fetchImTokenImpl: async () => {
      const error = new Error('unauthorized');
      error.status = 401;
      throw error;
    },
  });

  const recovered = await mod.recoverIMSession();

  assert.equal(recovered, false);
  assert.equal(calls.clearLocalSession, 1);
  assert.deepEqual(calls.routerReplace, ['/(auth)/login']);
  assert.equal(mod.isIMReloginPending(), false);
  assert.equal(calls.imSetError.length, 1);
});

test('token recovery: 403（本会话不发 IM 凭证）既不登出也不记欠账', async () => {
  const { mod, calls } = buildHarness({
    fetchImTokenImpl: async () => {
      const error = new Error('admin audience');
      error.status = 403;
      throw error;
    },
  });

  const recovered = await mod.recoverIMSession();

  assert.equal(recovered, false);
  assert.equal(calls.clearLocalSession, 0);
  assert.deepEqual(calls.routerReplace, []);
  assert.equal(mod.isIMReloginPending(), false);
});

test('token recovery: 单飞 —— 并发调用只发一次 im-token 请求', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { mod, calls } = buildHarness({
    fetchImTokenImpl: async () => {
      await gate;
      return 'fresh-token';
    },
  });

  const first = mod.recoverIMSession();
  const second = mod.recoverIMSession();
  release();

  const results = await Promise.all([first, second]);
  assert.deepEqual(results, [true, true]);
  assert.equal(calls.fetchImToken, 1);
  assert.equal(calls.executor.length, 1);
});

test('token recovery: 恢复期间切号（sessionEpoch 变化）丢弃旧会话的 token', async () => {
  const { mod, calls, authState } = buildHarness({
    fetchImTokenImpl: async () => {
      // fetch 返回前用户切了账号
      authState.sessionEpoch = 2;
      return 'stale-session-token';
    },
  });

  const recovered = await mod.recoverIMSession();

  assert.equal(recovered, false);
  assert.deepEqual(calls.setImToken, []);
  assert.deepEqual(calls.executor, []);
});

test('token recovery: 无业务会话 / onboarding 未完成时不发请求', async () => {
  for (const overrides of [
    { accessToken: null },
    { user: null },
    { onboardingRequired: true },
  ]) {
    const { mod, calls } = buildHarness({ authState: overrides });
    const recovered = await mod.recoverIMSession();
    assert.equal(recovered, false);
    assert.equal(calls.fetchImToken, 0);
  }
});

// ---------------------------------------------------------------------------
// 纯函数：token-errors
// ---------------------------------------------------------------------------

test('isOpenIMTokenRejectedError 识别 1501-1506 与 token 文案，放过网络类失败', () => {
  const { isOpenIMTokenRejectedError } = loadTsModule('src/im/token-errors.ts');

  assert.equal(isOpenIMTokenRejectedError({ code: 1501 }), true);
  assert.equal(isOpenIMTokenRejectedError({ code: 1506 }), true);
  assert.equal(
    isOpenIMTokenRejectedError(new Error('errCode 1502: token invalid')),
    true,
  );
  assert.equal(
    isOpenIMTokenRejectedError(new Error('Token is expired')),
    true,
  );

  assert.equal(isOpenIMTokenRejectedError({ code: 10004 }), false);
  assert.equal(isOpenIMTokenRejectedError(new Error('network timeout')), false);
  assert.equal(isOpenIMTokenRejectedError(null), false);
  assert.equal(isOpenIMTokenRejectedError(new Error('errCode 15010')), false);
});

// ---------------------------------------------------------------------------
// 接线断言：过期事件不再一刀切登出；bootstrap 补登路径接上 recovery
// ---------------------------------------------------------------------------

test('IM token 过期事件走原地恢复，不再直接清 session 跳登录页 (#83)', () => {
  const listeners = read('src/im/listeners.ts');
  const handler = listeners.slice(
    listeners.indexOf('const handleTokenExpired'),
    listeners.indexOf("OpenIMSDK.on('onUserTokenExpired'"),
  );

  assert.match(handler, /recoverIMSession\(\)/);
  assert.doesNotMatch(handler, /clearLocalSession/);
  assert.doesNotMatch(handler, /router\.replace/);
  // 不再把「登录已过期」文案写进 IM 错误态——业务会话可能还活着
  assert.doesNotMatch(handler, /setError\((?!null)/);
});

test('bootstrap: 空 imToken 会话可通过 GET /auth/im-token 恢复 (#85)', () => {
  const bootstrap = read('src/components/app/session-bootstrap.tsx');

  // 冷启动无 imToken → 换新 token 补登，而不是放弃整个会话周期
  assert.match(bootstrap, /await logoutFromOpenIM\(\);\s*void recoverIMSession\(\)/);
  // 前台恢复路径消费 token-recovery 的欠账
  assert.match(bootstrap, /isIMReloginPending\(\)/);
  // 缓存 token 被服务端拒绝时改走换新 token 路径
  assert.match(bootstrap, /isOpenIMTokenRejectedError\(error\)/);
});

test('fetchImToken 打到 GET /auth/im-token 并拒绝空 token', () => {
  const auth = read('src/services/api/auth.ts');
  assert.match(auth, /\/auth\/im-token\?platform=/);
  assert.match(auth, /imToken\.length === 0/);
});

test('刷新后重试仍 401 → 清 session 并抛 auth-retry-failed (#111)', () => {
  const client = read('src/services/api/client.ts');
  assert.match(client, /failureKind: 'auth-retry-failed'/);
  const retryBlock = client.slice(
    client.indexOf('const retryRequest = await executeRequest'),
    client.indexOf("failureKind: 'auth-retry-failed'"),
  );
  assert.match(retryBlock, /retryRequest\.res\.status === 401/);
  assert.match(retryBlock, /clearLocalSession\(requestSessionEpoch\)/);
});
