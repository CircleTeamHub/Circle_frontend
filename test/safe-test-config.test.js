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
    /not allowlisted/,
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
        baseE2EEnv({ ...auth, E2E_FRIEND_ID: 'friend-1' }),
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
});
