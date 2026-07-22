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
    clearEpochs: [],
    routerReplace: [],
    imSetError: [],
    executor: [],
    knownUpserts: [],
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
    currentUserID: null,
    setError: (message) => {
      calls.imSetError.push(message);
    },
  };
  const knownAccounts = [];

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
      clearLocalSession: async (expectedEpoch) => {
        calls.clearLocalSession += 1;
        calls.clearEpochs.push(expectedEpoch);
      },
    },
    '@/stores/authStore': {
      useAuthStore: { getState: () => authState },
    },
    '@/stores/imStore': {
      useIMStore: { getState: () => imState },
    },
    '@/stores/knownAccountsStore': {
      useKnownAccountsStore: {
        getState: () => ({
          accounts: knownAccounts,
          upsertAccount: (account) => {
            calls.knownUpserts.push(account);
          },
        }),
      },
    },
    '@/im/user-id': loadTsModule('src/im/user-id.ts'),
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

  return { mod, calls, authState, imState, knownAccounts };
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
  // RN 原生层的 errCode/errMsg 形状（review 修复：此前 String() 成
  // '[object Object]' 后被当瞬时失败反复重试同一枚死 token）
  assert.equal(
    isOpenIMTokenRejectedError({ errCode: 1502, errMsg: 'token invalid' }),
    true,
  );
  assert.equal(isOpenIMTokenRejectedError({ errCode: 1501 }), true);
  assert.equal(
    isOpenIMTokenRejectedError({ errCode: 10008, errMsg: 'network down' }),
    false,
  );
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

test('终局失败但会话已切换：clear 锚定旧 epoch，不跳登录页不写错误态 (review)', async () => {
  const authError = Object.assign(new Error('unauthorized'), { status: 401 });
  let harness;
  harness = buildHarness({
    fetchImTokenImpl: async () => {
      // 请求 unwinding 期间用户已重新登录：epoch 前进
      harness.authState.sessionEpoch = 2;
      throw authError;
    },
  });

  const recovered = await harness.mod.recoverIMSession();

  assert.equal(recovered, false);
  // clear 仍会调用，但带着 startEpoch=1 —— 真实实现里对新会话是 no-op
  assert.deepEqual(harness.calls.clearEpochs, [1]);
  // 新会话绝不能被踢回登录页 / 写「登录已过期」
  assert.deepEqual(harness.calls.routerReplace, []);
  assert.deepEqual(harness.calls.imSetError, []);
});

test('单飞按 sessionEpoch 记账：切号后当前会话另起恢复，不复用旧在飞 (review)', async () => {
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const { mod, calls, authState } = buildHarness({
    executor: async () => {
      await firstGate;
      return true;
    },
  });

  const first = mod.recoverIMSession();
  // 换会话
  authState.sessionEpoch = 2;
  const second = mod.recoverIMSession();
  releaseFirst();

  const [firstResult, secondResult] = await Promise.all([first, second]);
  // 旧会话恢复：executor await 后发现 epoch 已变 → false
  assert.equal(firstResult, false);
  // 新会话的恢复独立起飞（第二次 fetchImToken）
  assert.equal(calls.fetchImToken, 2);
  assert.equal(typeof secondResult, 'boolean');
});

test('executor await 期间切号：SDK 还连着旧身份才拆除 (review + round 2)', async () => {
  let logoutCalls = 0;
  let harness;
  harness = buildHarness({
    executor: async () => {
      // 登录成功返回前用户已切号；SDK 此刻连着的还是旧用户（round 2：
      // 拆除范围限定于此 —— currentUserID 与旧用户 IM id 相同）
      harness.authState.sessionEpoch = 99;
      harness.imState.currentUserID = 'user1'; // toImUserId('user-1')
      return true;
    },
  });
  harness.mod.registerIMLogoutExecutor(async () => {
    logoutCalls += 1;
  });

  const recovered = await harness.mod.recoverIMSession();

  assert.equal(recovered, false);
  // 刚完成的是旧用户的 OpenIM 登录 —— 必须拆除，防消息路由到错误身份
  assert.equal(logoutCalls, 1);
  assert.equal(harness.mod.isIMReloginPending(), false);
});

test('executor await 期间切号：B 已登上自己的 IM 时绝不拆 (round 2)', async () => {
  let logoutCalls = 0;
  let harness;
  harness = buildHarness({
    executor: async () => {
      harness.authState.sessionEpoch = 99;
      // B 会话已完成自己的 IM 登录：currentUserID 是 B 的 im id
      harness.imState.currentUserID = 'userB';
      return true;
    },
  });
  harness.mod.registerIMLogoutExecutor(async () => {
    logoutCalls += 1;
  });

  const recovered = await harness.mod.recoverIMSession();

  assert.equal(recovered, false);
  // 无差别 logout 会把 B 刚建好的会话拆掉 —— 必须跳过
  assert.equal(logoutCalls, 0);
});

test('恢复成功把新 imToken 写回 knownAccountsStore（切走再切回不用死 token）(round 2)', async () => {
  const harness = buildHarness();
  harness.knownAccounts.push({
    user: { id: 'user-1' },
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    imToken: 'dead-im-token',
    updatedAt: 1,
  });
  harness.authState.accessToken = 'access-a';
  harness.authState.refreshToken = 'refresh-a';

  const recovered = await harness.mod.recoverIMSession();

  assert.equal(recovered, true);
  assert.equal(harness.calls.knownUpserts.length, 1);
  const upsert = JSON.parse(JSON.stringify(harness.calls.knownUpserts[0]));
  assert.equal(upsert.imToken, 'fresh-token');
  assert.equal(upsert.user.id, 'user-1');
});

test('client：forceRelogin 下 10102 不再当成功（死 token 会话不能清欠账）(round 2)', () => {
  const client = read('src/im/client.ts');
  const dupBlock = client.slice(
    client.indexOf("code === 10102 || msg.includes('User has logged in repeatedly')"),
    client.indexOf('登录失败时重置 connecting'),
  );
  assert.match(dupBlock, /options\.forceRelogin/);
  assert.match(dupBlock, /throw error;/);
});

test('恢复执行器强制真登录：Logged 快捷不吞新 token (review P1)', () => {
  const client = read('src/im/client.ts');

  // 注册给 token-recovery 的执行器必须带 forceRelogin
  assert.match(
    client,
    /registerIMLoginExecutor\(\(userId, imToken\) =>\s*loginToOpenIM\(userId, imToken, \{ forceRelogin: true \}\)/,
  );
  // forceRelogin 分支：Logged 状态下先 logout 再干净重登（不能走复用快捷）
  const forced = client.slice(
    client.indexOf('options.forceRelogin'),
    client.indexOf('} else if (status === LoginStatus.Logged)'),
  );
  assert.match(forced, /OpenIMSDK\.logout\(\)/);
  // 陈旧登录拆除执行器也已注入
  assert.match(client, /registerIMLogoutExecutor\(\(\) => logoutFromOpenIM\(\)\)/);
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
