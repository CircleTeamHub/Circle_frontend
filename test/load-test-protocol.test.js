const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = process.cwd();

function load(moduleName) {
  return import(
    pathToFileURL(path.join(root, 'load-tests', 'lib', moduleName)).href
  );
}

test('Socket.IO packets encode auth, events, and acknowledgements', async () => {
  const { encodeConnect, encodeEvent, parsePacket } = await load('socket-io.js');

  assert.equal(encodeConnect('secret-token'), '40{"token":"secret-token"}');
  assert.equal(
    encodeEvent('chat:send', { conversationId: 'c-1' }, 7),
    '427["chat:send",{"conversationId":"c-1"}]',
  );
  assert.deepEqual(parsePacket('0{"sid":"engine-1"}'), {
    kind: 'engine-open',
    data: { sid: 'engine-1' },
  });
  assert.deepEqual(parsePacket('2'), { kind: 'ping' });
  assert.deepEqual(parsePacket('43' + '7[{"ok":true}]'), {
    kind: 'ack',
    id: 7,
    args: [{ ok: true }],
  });
});

test('Socket.IO parser recognizes events and rejects malformed packets', async () => {
  const { parsePacket } = await load('socket-io.js');

  assert.deepEqual(parsePacket('42["chat:msg",{"id":"m-1"}]'), {
    kind: 'event',
    event: 'chat:msg',
    args: [{ id: 'm-1' }],
  });
  assert.throws(() => parsePacket('42not-json'), /Malformed Socket.IO event/);
  assert.throws(() => parsePacket('43[{"ok":true}]'), /ack id/);
});

test('load account data is strict, unique, and never exposes tokens', async () => {
  const { parseAccounts, selectAccount, summarizeAccounts } = await load('data.js');
  const raw = [
    {
      alias: 'sender-01',
      accessToken: 'token-01',
      conversationIds: ['conversation-01'],
      circleIds: ['circle-01'],
    },
    {
      alias: 'receiver',
      accessToken: 'token-02',
      conversationIds: ['conversation-01'],
      circleIds: [],
    },
  ];
  const accounts = parseAccounts(raw);
  assert.equal(selectAccount(accounts, 3).alias, 'sender-01');
  assert.deepEqual(summarizeAccounts(accounts), [
    { alias: 'sender-01', conversations: 1, circles: 1 },
    { alias: 'receiver', conversations: 1, circles: 0 },
  ]);
  assert.doesNotMatch(JSON.stringify(summarizeAccounts(accounts)), /token-0/);
  assert.throws(() => parseAccounts([...raw, raw[0]]), /duplicate alias/);
  assert.throws(
    () => parseAccounts([{ alias: 'broken', accessToken: '', conversationIds: [] }]),
    /accessToken/,
  );
});

test('threshold builder covers latency, failure, delivery, and HTTP errors', async () => {
  const { buildThresholds } = await load('thresholds.js');
  const thresholds = buildThresholds({
    ackP95Ms: 1500,
    deliveryP95Ms: 2500,
    maxFailureRate: 0.02,
  });

  assert.deepEqual(thresholds.chat_ack_ms, ['p(95)<1500']);
  assert.deepEqual(thresholds.chat_delivery_ms, ['p(95)<2500']);
  assert.deepEqual(thresholds.chat_send_failed, ['rate<0.02']);
  assert.deepEqual(thresholds.http_req_failed, ['rate<0.02']);
  assert.throws(() => buildThresholds({ ackP95Ms: 0 }), /ackP95Ms/);
});

test('runtime config requires an explicitly safe target', async () => {
  const { parseRuntimeConfig } = await load('config.js');
  const env = {
    LOAD_API_URL: 'https://e2e-api.windnote.test',
    LOAD_SOCKET_URL: 'wss://e2e-api.windnote.test',
    LOAD_ALLOWED_ORIGINS: 'https://e2e-api.windnote.test',
    LOAD_RUN_ID: 'run-20260818',
  };
  const config = parseRuntimeConfig(env);
  assert.equal(config.apiBaseUrl, 'https://e2e-api.windnote.test/api/v1');
  assert.equal(
    config.socketUrl,
    'wss://e2e-api.windnote.test/chat-ws/?EIO=4&transport=websocket',
  );
  assert.throws(
    () => parseRuntimeConfig({ ...env, LOAD_API_URL: 'https://api.windnote.ai' }),
    /allowlisted/,
  );
});
