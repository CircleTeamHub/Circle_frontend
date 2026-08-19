const RUN_ID = /^[A-Za-z0-9._-]{6,64}$/;
const PRODUCTION_HOSTS = new Set(['api.windnote.ai', 'windnote.ai', 'www.windnote.ai']);

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
  const api = readUrl(env, 'LOAD_API_URL', ['https:']);
  const socket = readUrl(env, 'LOAD_SOCKET_URL', ['https:', 'wss:']);
  const allowlist = allowedHosts(env);
  if (!allowlist.has(api.host) || !allowlist.has(socket.host)) {
    throw new Error('LOAD_API_URL and LOAD_SOCKET_URL must be allowlisted.');
  }
  if (api.host !== socket.host) throw new Error('Load API and socket hosts must match.');
  if (PRODUCTION_HOSTS.has(api.hostname.toLowerCase())) {
    throw new Error('Production WindNote hosts are never valid load-test targets.');
  }
  const runId = String(env.LOAD_RUN_ID ?? '').trim();
  if (!RUN_ID.test(runId)) throw new Error('LOAD_RUN_ID must be a safe 6-64 character id.');
  const apiPath = api.pathname.replace(/\/+$/, '');
  const socketProtocol = socket.protocol === 'https:' ? 'wss:' : socket.protocol;
  return Object.freeze({
    runId,
    apiBaseUrl: `${api.origin}${apiPath || '/api/v1'}`,
    socketUrl: `${socketProtocol}//${socket.host}/chat-ws/?EIO=4&transport=websocket`,
  });
}
