const test = require('node:test');
const assert = require('node:assert/strict');

async function loadConfig() {
  return import('../scripts/testing/safe-test-config.mjs');
}

const safeOrigin = 'https://e2e-api.windnote.test';

function baseE2EEnv(overrides = {}) {
  return {
    E2E_EXECUTE: 'true',
    E2E_API_URL: safeOrigin,
    E2E_SOCKET_URL: safeOrigin,
    E2E_ALLOWED_ORIGINS: safeOrigin,
    ...overrides,
  };
}

function baseLoadEnv(overrides = {}) {
  return {
    LOAD_EXECUTE: 'true',
    LOAD_API_URL: safeOrigin,
    LOAD_SOCKET_URL: safeOrigin,
    LOAD_ALLOWED_ORIGINS: safeOrigin,
    LOAD_ACCOUNTS_FILE: 'load-tests/data/accounts.local.json',
    LOAD_RUN_ID: 'run-20260818',
    ...overrides,
  };
}

test('read-only smoke requires explicit execution but no credentials', async () => {
  const { parseE2EConfig } = await loadConfig();
  assert.throws(
    () => parseE2EConfig(baseE2EEnv({ E2E_EXECUTE: undefined }), 'smoke'),
    /E2E_EXECUTE=true/,
  );

  const config = parseE2EConfig(baseE2EEnv(), 'smoke');
  assert.equal(config.suite, 'smoke');
  assert.equal(config.mutates, false);
  assert.equal(config.flow, '.maestro/flows/smoke.yaml');
});

test('mutating E2E rejects production before starting Maestro', async () => {
  const { parseE2EConfig } = await loadConfig();
  assert.throws(
    () =>
      parseE2EConfig(
        baseE2EEnv({
          E2E_ALLOW_MUTATION: 'true',
          E2E_API_URL: 'https://api.windnote.ai',
          E2E_SOCKET_URL: 'https://api.windnote.ai',
        }),
        'chat-message',
      ),
    /production|not allowlisted/i,
  );
});

// 这个仓库里没有生产域名 —— app 的端点是构建期由 vars.EXPO_PUBLIC_API_URL 注入的
// （见 .github/workflows/android-release.yml）。所以一张手写的域名清单没有任何机制
// 保证它跟真实部署同步，而它恰恰是操作者把生产误填进自己 allowlist 之后唯一还拦得
// 住的那道闸。下面三条钉的是：只要环境里存在权威来源，这道闸就跟着它走。
test('an unlisted production host is blocked when the app build variable names it', async () => {
  const { parseLoadConfig } = await loadConfig();
  const regional = 'https://api.windnote-regional.example';

  assert.throws(
    () =>
      parseLoadConfig(
        baseLoadEnv({
          LOAD_ALLOW_MUTATION: 'true',
          LOAD_API_URL: regional,
          LOAD_SOCKET_URL: regional,
          LOAD_ALLOWED_ORIGINS: regional,
          // 构建期真实端点在环境里 —— 零配置自动挡住
          EXPO_PUBLIC_API_URL: `${regional}/api/v1`,
        }),
        'chat-send',
      ),
    /production/i,
  );
});

test('an unlisted production host is blocked when CI declares it explicitly', async () => {
  const { parseLoadConfig } = await loadConfig();
  const regional = 'https://api.windnote-regional.example';

  assert.throws(
    () =>
      parseLoadConfig(
        baseLoadEnv({
          LOAD_ALLOW_MUTATION: 'true',
          LOAD_API_URL: regional,
          LOAD_SOCKET_URL: regional,
          LOAD_ALLOWED_ORIGINS: regional,
          LOAD_PRODUCTION_HOSTS: 'api.windnote-regional.example',
        }),
        'chat-send',
      ),
    /production/i,
  );
});

test('a real staging target still runs while the build variable points at production', async () => {
  const { parseLoadConfig } = await loadConfig();

  const config = parseLoadConfig(
    baseLoadEnv({
      LOAD_ALLOW_MUTATION: 'true',
      EXPO_PUBLIC_API_URL: 'https://api.windnote.ai/api/v1',
    }),
    'chat-send',
  );

  assert.equal(config.origins.apiOrigin, safeOrigin);
});

test('production hosts stay blocked even when someone mistakenly allowlists them', async () => {
  const { parseE2EConfig, parseLoadConfig } = await loadConfig();
  const production = 'https://api.windnote.ai';
  assert.throws(
    () =>
      parseE2EConfig(
        baseE2EEnv({
          E2E_API_URL: production,
          E2E_SOCKET_URL: production,
          E2E_ALLOWED_ORIGINS: production,
        }),
        'smoke',
      ),
    /production/i,
  );
  assert.throws(
    () =>
      parseLoadConfig(
        baseLoadEnv({
          LOAD_ALLOW_MUTATION: 'true',
          LOAD_API_URL: production,
          LOAD_SOCKET_URL: production,
          LOAD_ALLOWED_ORIGINS: production,
        }),
        'chat-send',
      ),
    /production/i,
  );
});

test('mutating E2E requires mutation opt-in and a safe run id', async () => {
  const { parseE2EConfig } = await loadConfig();
  const fixtures = {
    E2E_AUTH_MODE: 'password',
    E2E_EMAIL: 'runner@example.test',
    E2E_PASSWORD: 'not-a-real-password',
    E2E_CONVERSATION_ID: '11111111-1111-4111-8111-111111111111',
    E2E_CONVERSATION_NAME: 'E2E Conversation',
    E2E_RUN_ID: 'run-20260818',
  };

  assert.throws(
    () => parseE2EConfig(baseE2EEnv(fixtures), 'chat-message'),
    /E2E_ALLOW_MUTATION=true/,
  );
  assert.throws(
    () =>
      parseE2EConfig(
        baseE2EEnv({
          ...fixtures,
          E2E_ALLOW_MUTATION: 'true',
          E2E_RUN_ID: 'bad id',
        }),
        'chat-message',
      ),
    /E2E_RUN_ID/,
  );

  const config = parseE2EConfig(
    baseE2EEnv({ ...fixtures, E2E_ALLOW_MUTATION: 'true' }),
    'chat-message',
  );
  assert.equal(config.mutates, true);
  assert.equal(config.maestroEnv.E2E_RUN_ID, 'run-20260818');
});

test('authentication modes never silently fall back', async () => {
  const { parseE2EConfig } = await loadConfig();
  assert.throws(
    () =>
      parseE2EConfig(
        baseE2EEnv({ E2E_AUTH_MODE: 'password', E2E_EMAIL: 'a@example.test' }),
        'auth-navigation',
      ),
    /E2E_PASSWORD/,
  );
  assert.throws(
    () =>
      parseE2EConfig(
        baseE2EEnv({
          E2E_AUTH_MODE: 'verification-code',
          E2E_EMAIL: 'a@example.test',
          E2E_VERIFICATION_CODE: '12345',
        }),
        'auth-navigation',
      ),
    /six digits/,
  );
});

test('non-auth suites ignore a stale auth mode without credentials', async () => {
  const { parseE2EConfig } = await loadConfig();
  // 操作者的 shell / e2e/.env 里常年留着 E2E_AUTH_MODE，但 smoke 不登录，
  // 缺 E2E_PASSWORD 不能让它崩在 undefined.trim()。
  const config = parseE2EConfig(
    baseE2EEnv({ E2E_AUTH_MODE: 'password', E2E_PASSWORD: undefined }),
    'smoke',
  );
  assert.equal(config.auth, false);
  assert.deepEqual(config.maestroSecretEnv, {});

  const codeConfig = parseE2EConfig(
    baseE2EEnv({ E2E_AUTH_MODE: 'verification-code' }),
    'smoke',
  );
  assert.deepEqual(codeConfig.maestroSecretEnv, {});

  // 即使凭据在环境里，非认证 suite 也不把它们带给 Maestro 子进程。
  const withSecrets = parseE2EConfig(
    baseE2EEnv({ E2E_AUTH_MODE: 'password', E2E_PASSWORD: 'unused-secret' }),
    'smoke',
  );
  assert.deepEqual(withSecrets.maestroSecretEnv, {});
});

test('E2E config binds Maestro to the installed app runtime target', async () => {
  const { parseE2EConfig } = await loadConfig();
  const config = parseE2EConfig(baseE2EEnv(), 'smoke');

  assert.equal(
    config.maestroEnv.E2E_API_TARGET_ID,
    'windnote_runtime_api_origin_00680074007400700073003a002f002f006500320065002d006100700069002e00770069006e0064006e006f00740065002e0074006500730074',
  );
});

test('social flow requires exact friend and circle fixture ids', async () => {
  const { parseE2EConfig } = await loadConfig();
  const auth = {
    E2E_AUTH_MODE: 'password',
    E2E_EMAIL: 'runner@example.test',
    E2E_PASSWORD: 'not-a-real-password',
  };
  assert.throws(
    () => parseE2EConfig(baseE2EEnv(auth), 'social-circle'),
    /E2E_FRIEND_ID/,
  );
  assert.throws(
    () =>
      parseE2EConfig(
        baseE2EEnv({
          ...auth,
          E2E_FRIEND_ID: 'friend-1',
          E2E_FRIEND_ACCOUNT: 'friend@example.test',
        }),
        'social-circle',
      ),
    /E2E_CIRCLE_ID/,
  );
});

test('load scenarios require explicit mutation and account data', async () => {
  const { parseLoadConfig } = await loadConfig();
  assert.throws(
    () => parseLoadConfig(baseLoadEnv({ LOAD_EXECUTE: undefined }), 'chat-send'),
    /LOAD_EXECUTE=true/,
  );
  assert.throws(
    () => parseLoadConfig(baseLoadEnv(), 'chat-send'),
    /LOAD_ALLOW_MUTATION=true/,
  );

  const config = parseLoadConfig(
    baseLoadEnv({ LOAD_ALLOW_MUTATION: 'true' }),
    'chat-send',
  );
  assert.equal(config.scenario, 'chat-send');
  assert.equal(config.script, 'load-tests/scenarios/chat-send.js');
});

test('large performance fixtures need a second opt-in', async () => {
  const { parseLoadConfig } = await loadConfig();
  const env = baseLoadEnv({
    LOAD_ALLOW_MUTATION: 'true',
    LOAD_CONVERSATIONS: '500',
    LOAD_MESSAGES_PER_CONVERSATION: '100',
  });
  assert.throws(
    () => parseLoadConfig(env, 'inbox-seed'),
    /LOAD_PERFORMANCE_FIXTURE=true/,
  );
  const config = parseLoadConfig(
    { ...env, LOAD_PERFORMANCE_FIXTURE: 'true' },
    'inbox-seed',
  );
  assert.equal(config.k6Env.LOAD_CONVERSATIONS, '500');
});

test('redaction never exposes tokens, codes, or passwords', async () => {
  const { redactTestValue, redactTestObject } = await loadConfig();
  assert.equal(redactTestValue('abc123456789'), '[REDACTED]');
  assert.deepEqual(
    redactTestObject({ accessToken: 'token', password: 'secret', nested: { code: '123456' } }),
    { accessToken: '[REDACTED]', password: '[REDACTED]', nested: { code: '[REDACTED]' } },
  );
});

test('runners build argv arrays without logging or shell interpolation', async () => {
  const { buildMaestroArgs } = await import('../scripts/run-e2e.mjs');
  const { buildK6Args } = await import('../scripts/run-load.mjs');
  const maestroArgs = buildMaestroArgs({
    flow: '.maestro/flows/smoke.yaml',
    maestroEnv: { APP_ID: 'com.yiboding.circleim', E2E_EMAIL: 'runner@example.test' },
  });
  assert.deepEqual(maestroArgs, [
    'test',
    '-e',
    'APP_ID=com.yiboding.circleim',
    '-e',
    'E2E_EMAIL=runner@example.test',
    '.maestro/flows/smoke.yaml',
  ]);
  assert.deepEqual(
    buildK6Args({ script: 'load-tests/scenarios/chat-send.js' }),
    ['run', 'load-tests/scenarios/chat-send.js'],
  );
  assert.deepEqual(
    buildMaestroArgs({
      flow: '.maestro/performance/chat-history-scroll.yaml',
      maestroEnv: { APP_ID: 'com.yiboding.circleim' },
      deviceId: 'emulator-5554',
    }),
    [
      '--device',
      'emulator-5554',
      'test',
      '-e',
      'APP_ID=com.yiboding.circleim',
      '.maestro/performance/chat-history-scroll.yaml',
    ],
  );
});

test('Maestro credentials are inherited through MAESTRO shell variables, never argv', async () => {
  const { parseE2EConfig } = await loadConfig();
  const { buildMaestroInvocation } = await import('../scripts/run-e2e.mjs');
  const password = 'secret-password-value';
  const code = '123456';
  const config = parseE2EConfig(
    baseE2EEnv({
      E2E_AUTH_MODE: 'password',
      E2E_EMAIL: 'runner@example.test',
      E2E_PASSWORD: password,
    }),
    'auth-navigation',
  );
  const invocation = buildMaestroInvocation(config, {
    PATH: 'test-path',
    MAESTRO_E2E_VERIFICATION_CODE: code,
  });

  const commandLine = invocation.args.join(' ');
  assert.doesNotMatch(commandLine, new RegExp(password));
  assert.doesNotMatch(commandLine, new RegExp(code));
  assert.equal(invocation.env.MAESTRO_E2E_PASSWORD, password);
  assert.equal(invocation.env.MAESTRO_E2E_VERIFICATION_CODE, undefined);
  assert.equal(invocation.env.PATH, 'test-path');
  assert.equal(config.maestroEnv.E2E_PASSWORD, undefined);
  assert.equal(config.maestroSecretEnv.MAESTRO_E2E_PASSWORD, password);

  const codeConfig = parseE2EConfig(
    baseE2EEnv({
      E2E_AUTH_MODE: 'verification-code',
      E2E_EMAIL: 'runner@example.test',
      E2E_VERIFICATION_CODE: code,
    }),
    'auth-navigation',
  );
  const codeInvocation = buildMaestroInvocation(codeConfig, { PATH: 'test-path' });
  assert.doesNotMatch(codeInvocation.args.join(' '), new RegExp(code));
  assert.equal(codeInvocation.env.MAESTRO_E2E_VERIFICATION_CODE, code);
  assert.equal(codeConfig.maestroEnv.E2E_VERIFICATION_CODE, undefined);
});
