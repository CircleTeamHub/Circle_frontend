import { resolveProductionHosts } from './production-hosts.js';

const RUN_ID = /^[A-Za-z0-9._-]{6,64}$/;

function readUrl(env, key, protocols) {
  let value;
  try {
    value = new URL(env[key]);
  } catch {
    throw new Error(`${key} must be an absolute URL.`);
  }
  if (!protocols.includes(value.protocol)) {
    throw new Error(`${key} must use ${protocols.join(' or ')}.`);
  }
  if (value.username || value.password || value.search || value.hash) {
    throw new Error(`${key} must not contain credentials, query, or fragment.`);
  }
  return value;
}

function allowedHosts(env) {
  const values = String(env.LOAD_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (values.length === 0) throw new Error('LOAD_ALLOWED_ORIGINS is required.');
  return new Set(values.map((value) => readUrl({ value }, 'value', ['https:', 'wss:']).host));
}

export function parseRuntimeConfig(env) {
  if (env.LOAD_EXECUTE !== 'true' || env.LOAD_ALLOW_MUTATION !== 'true') {
    throw new Error('LOAD_EXECUTE=true and LOAD_ALLOW_MUTATION=true are required.');
  }
  const api = readUrl(env, 'LOAD_API_URL', ['https:']);
  const socket = readUrl(env, 'LOAD_SOCKET_URL', ['https:', 'wss:']);
  const allowlist = allowedHosts(env);
  if (!allowlist.has(api.host) || !allowlist.has(socket.host)) {
    throw new Error('LOAD_API_URL and LOAD_SOCKET_URL must be allowlisted.');
  }
  if (api.host !== socket.host) throw new Error('Load API and socket hosts must match.');
  // 生产域名不是写死的清单，而是从环境里解析出来的：app 自己的构建变量指向
  // 哪儿哪儿就是生产（见 production-hosts.js）。socket 也要查 —— 上面虽然强制
  // 两者同 host，但那道检查在这之后，不能靠它兜底。
  const productionHosts = resolveProductionHosts(env, 'LOAD');
  if (
    productionHosts.has(api.hostname.toLowerCase()) ||
    productionHosts.has(socket.hostname.toLowerCase())
  ) {
    throw new Error('Production WindNote hosts are never valid load-test targets.');
  }
  const runId = String(env.LOAD_RUN_ID ?? '').trim();
  if (!RUN_ID.test(runId)) throw new Error('LOAD_RUN_ID must be a safe 6-64 character id.');
  const apiPath = api.pathname.replace(/\/+$/, '');
  const socketProtocol = socket.protocol === 'https:' ? 'wss:' : socket.protocol;
  const readInteger = (key, fallback, min, max) => {
    const raw = String(env[key] ?? fallback);
    if (!/^\d+$/.test(raw)) throw new Error(`${key} must be an integer.`);
    const value = Number(raw);
    if (value < min || value > max) throw new Error(`${key} is outside its safe bounds.`);
    return value;
  };
  return Object.freeze({
    runId,
    apiBaseUrl: `${api.origin}${apiPath || '/api/v1'}`,
    socketUrl: `${socketProtocol}//${socket.host}/chat-ws/?EIO=4&transport=websocket`,
    vus: readInteger('LOAD_VUS', 1, 1, 10000),
    durationSeconds: readInteger('LOAD_DURATION_SECONDS', 30, 1, 3600),
    conversations: readInteger('LOAD_CONVERSATIONS', 100, 1, 1000),
    messagesPerConversation: readInteger(
      'LOAD_MESSAGES_PER_CONVERSATION',
      20,
      1,
      200,
    ),
    targetAlias: String(env.LOAD_TARGET_ALIAS ?? '').trim(),
  });
}
