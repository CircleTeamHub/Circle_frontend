const APP_ID = 'com.yiboding.circleim';
const RUN_ID_PATTERN = /^[A-Za-z0-9._-]{6,64}$/;
const SENSITIVE_KEY_PATTERN = /(token|password|code|secret|credential)/i;

const E2E_SUITES = Object.freeze({
  smoke: { flow: '.maestro/flows/smoke.yaml', auth: false, mutates: false },
  'auth-navigation': {
    flow: '.maestro/flows/auth-navigation.yaml',
    auth: true,
    mutates: false,
  },
  'chat-message': {
    flow: '.maestro/flows/chat-message.yaml',
    auth: true,
    mutates: true,
    fixtures: ['E2E_CONVERSATION_ID', 'E2E_CONVERSATION_NAME'],
  },
  'moment-lifecycle': {
    flow: '.maestro/flows/moment-lifecycle.yaml',
    auth: true,
    mutates: true,
    fixtures: ['E2E_DELETE_LABEL'],
  },
  'profile-settings': {
    flow: '.maestro/flows/profile-settings.yaml',
    auth: true,
    mutates: true,
    fixtures: ['E2E_ORIGINAL_NICKNAME'],
  },
  'social-circle': {
    flow: '.maestro/flows/social-circle.yaml',
    auth: true,
    mutates: false,
    fixtures: [
      'E2E_FRIEND_ID',
      'E2E_FRIEND_ACCOUNT',
      'E2E_CIRCLE_ID',
      'E2E_CIRCLE_NAME',
    ],
  },
  'conversation-list-scroll': {
    flow: '.maestro/performance/conversation-list-scroll.yaml',
    auth: true,
    mutates: false,
    fixtures: ['E2E_PERF_CONVERSATION_ID'],
  },
  'chat-history-scroll': {
    flow: '.maestro/performance/chat-history-scroll.yaml',
    auth: true,
    mutates: true,
    fixtures: ['E2E_PERF_CONVERSATION_ID'],
  },
  'conversation-switch-storm': {
    flow: '.maestro/performance/conversation-switch-storm.yaml',
    auth: true,
    mutates: false,
    fixtures: ['E2E_PERF_CONVERSATION_ID', 'E2E_PERF_SECOND_CONVERSATION_ID'],
  },
});

const LOAD_SCENARIOS = Object.freeze({
  'chat-send': 'load-tests/scenarios/chat-send.js',
  'chat-fan-in': 'load-tests/scenarios/chat-fan-in.js',
  'circle-join': 'load-tests/scenarios/circle-join.js',
  'inbox-seed': 'load-tests/scenarios/inbox-seed.js',
});

function requireExactTrue(env, name) {
  if (env[name] !== 'true') {
    throw new Error(`${name}=true is required.`);
  }
}

function requireValue(env, name) {
  const value = typeof env[name] === 'string' ? env[name].trim() : '';
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function parseAllowlist(value, name) {
  const entries = String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => parseSafeOrigin(entry, name));
  if (entries.length === 0) throw new Error(`${name} must contain at least one origin.`);
  return new Set(entries);
}

function parseSafeOrigin(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid absolute URL.`);
  }
  if (!['https:', 'wss:'].includes(url.protocol)) {
    throw new Error(`${name} must use HTTPS or WSS.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must not contain credentials, query, or fragment.`);
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (path) throw new Error(`${name} must be an origin without a path.`);
  return url.origin;
}

function validateOrigins(env, prefix) {
  const allowed = parseAllowlist(env[`${prefix}_ALLOWED_ORIGINS`], `${prefix}_ALLOWED_ORIGINS`);
  const apiOrigin = parseSafeOrigin(requireValue(env, `${prefix}_API_URL`), `${prefix}_API_URL`);
  const socketOrigin = parseSafeOrigin(
    requireValue(env, `${prefix}_SOCKET_URL`),
    `${prefix}_SOCKET_URL`,
  );
  if (!allowed.has(apiOrigin)) throw new Error(`${prefix}_API_URL is not allowlisted.`);
  if (!allowed.has(socketOrigin)) throw new Error(`${prefix}_SOCKET_URL is not allowlisted.`);
  const apiHost = new URL(apiOrigin).host;
  const socketHost = new URL(socketOrigin).host;
  if (apiHost !== socketHost) {
    throw new Error(`${prefix}_API_URL and ${prefix}_SOCKET_URL must use the same host.`);
  }
  return { apiOrigin, socketOrigin, allowedOrigins: [...allowed] };
}

function validateAuth(env) {
  const mode = requireValue(env, 'E2E_AUTH_MODE');
  if (!['password', 'verification-code'].includes(mode)) {
    throw new Error('E2E_AUTH_MODE must be password or verification-code.');
  }
  const email = requireValue(env, 'E2E_EMAIL');
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
    throw new Error('E2E_EMAIL must contain one valid email address.');
  }
  if (mode === 'password') {
    requireValue(env, 'E2E_PASSWORD');
  } else {
    const code = requireValue(env, 'E2E_VERIFICATION_CODE');
    if (!/^\d{6}$/.test(code)) {
      throw new Error('E2E_VERIFICATION_CODE must contain exactly six digits.');
    }
  }
  return mode;
}

function copyDefined(env, names) {
  return Object.fromEntries(
    names
      .filter((name) => typeof env[name] === 'string' && env[name].trim())
      .map((name) => [name, env[name].trim()]),
  );
}

export function parseE2EConfig(env, suiteName) {
  const suite = E2E_SUITES[suiteName];
  if (!suite) {
    throw new Error(`Unknown E2E suite: ${suiteName}.`);
  }
  requireExactTrue(env, 'E2E_EXECUTE');
  const origins = validateOrigins(env, 'E2E');

  if (suite.auth) validateAuth(env);
  for (const fixture of suite.fixtures ?? []) requireValue(env, fixture);

  if (suite.mutates) {
    requireExactTrue(env, 'E2E_ALLOW_MUTATION');
    const runId = requireValue(env, 'E2E_RUN_ID');
    if (!RUN_ID_PATTERN.test(runId)) {
      throw new Error('E2E_RUN_ID must use 6-64 letters, digits, dots, underscores, or hyphens.');
    }
  }

  const maestroEnv = {
    APP_ID,
    E2E_API_URL: origins.apiOrigin,
    E2E_SOCKET_URL: origins.socketOrigin,
    ...copyDefined(env, [
      'E2E_AUTH_MODE',
      'E2E_EMAIL',
      'E2E_PASSWORD',
      'E2E_VERIFICATION_CODE',
      'E2E_RUN_ID',
      'E2E_CONVERSATION_ID',
      'E2E_CONVERSATION_NAME',
      'E2E_ORIGINAL_NICKNAME',
      'E2E_FRIEND_ID',
      'E2E_FRIEND_ACCOUNT',
      'E2E_CIRCLE_ID',
      'E2E_CIRCLE_NAME',
      'E2E_DELETE_LABEL',
      'E2E_PERF_CONVERSATION_ID',
      'E2E_PERF_SECOND_CONVERSATION_ID',
    ]),
  };

  return Object.freeze({
    suite: suiteName,
    flow: suite.flow,
    auth: suite.auth,
    mutates: suite.mutates,
    appId: APP_ID,
    origins,
    maestroEnv,
  });
}

function parseBoundedInteger(env, name, defaultValue, min, max) {
  const raw = env[name] ?? String(defaultValue);
  if (!/^\d+$/.test(String(raw))) throw new Error(`${name} must be an integer.`);
  const value = Number(raw);
  if (value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return value;
}

export function parseLoadConfig(env, scenarioName) {
  const script = LOAD_SCENARIOS[scenarioName];
  if (!script) throw new Error(`Unknown load scenario: ${scenarioName}.`);
  requireExactTrue(env, 'LOAD_EXECUTE');
  requireExactTrue(env, 'LOAD_ALLOW_MUTATION');
  const origins = validateOrigins(env, 'LOAD');
  const accountsFile = requireValue(env, 'LOAD_ACCOUNTS_FILE');
  const vus = parseBoundedInteger(env, 'LOAD_VUS', 1, 1, 10000);
  const durationSeconds = parseBoundedInteger(env, 'LOAD_DURATION_SECONDS', 30, 1, 3600);
  const conversations = parseBoundedInteger(env, 'LOAD_CONVERSATIONS', 100, 1, 1000);
  const messagesPerConversation = parseBoundedInteger(
    env,
    'LOAD_MESSAGES_PER_CONVERSATION',
    20,
    1,
    200,
  );
  if (
    scenarioName === 'inbox-seed' &&
    (conversations >= 500 || messagesPerConversation >= 100)
  ) {
    requireExactTrue(env, 'LOAD_PERFORMANCE_FIXTURE');
  }

  return Object.freeze({
    scenario: scenarioName,
    script,
    accountsFile,
    origins,
    k6Env: {
      LOAD_API_URL: origins.apiOrigin,
      LOAD_SOCKET_URL: origins.socketOrigin,
      LOAD_ACCOUNTS_FILE: accountsFile,
      LOAD_VUS: String(vus),
      LOAD_DURATION_SECONDS: String(durationSeconds),
      LOAD_CONVERSATIONS: String(conversations),
      LOAD_MESSAGES_PER_CONVERSATION: String(messagesPerConversation),
      ...copyDefined(env, ['LOAD_RUN_ID', 'LOAD_TARGET_ALIAS']),
    },
  });
}

export function redactTestValue(_value) {
  return '[REDACTED]';
}

export function redactTestObject(value) {
  if (Array.isArray(value)) return value.map(redactTestObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : redactTestObject(entry),
    ]),
  );
}

export const supportedE2ESuites = Object.freeze(Object.keys(E2E_SUITES));
export const supportedLoadScenarios = Object.freeze(Object.keys(LOAD_SCENARIOS));
