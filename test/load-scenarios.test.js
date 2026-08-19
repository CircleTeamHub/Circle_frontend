const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const scenarios = ['chat-send', 'chat-fan-in', 'circle-join', 'inbox-seed'];

test('all load scenarios use shared guarded config and account data', () => {
  for (const name of scenarios) {
    const source = fs.readFileSync(
      path.join(root, 'load-tests', 'scenarios', `${name}.js`),
      'utf8',
    );
    assert.match(source, /parseRuntimeConfig\(__ENV\)/, name);
    assert.match(source, /loadAccounts\(/, name);
    assert.doesNotMatch(source, /api\.windnote\.ai|windnote\.ai\/api/i, name);
    assert.doesNotMatch(source, /accessToken\s*:\s*['"][^'"]+['"]/, name);
  }
});

test('chat scenarios measure ack failures and end-to-end delivery', () => {
  const sharedSession = fs.readFileSync(
    path.join(root, 'load-tests', 'lib', 'socket-session.js'),
    'utf8',
  );
  for (const name of ['chat-send', 'chat-fan-in', 'inbox-seed']) {
    const source = fs.readFileSync(
      path.join(root, 'load-tests', 'scenarios', `${name}.js`),
      'utf8',
    );
    assert.match(source, /chatAckMs/, name);
    assert.match(source, /chatSendFailed/, name);
    assert.match(source, /chatDeliveryMs/, name);
    assert.match(source + sharedSession, /WINDNOTE-LOAD-\$\{config\.runId\}/, name);
  }
  assert.match(sharedSession, /batchSize/);
  assert.match(sharedSession, /reason:\s*'unsent'/);
});

test('chat sessions exclude their own echo from delivery accounting', () => {
  const source = fs.readFileSync(
    path.join(root, 'load-tests', 'lib', 'socket-session.js'),
    'utf8',
  );

  // chat:msg 会广播回发送者自己。把回声也算成一次投递，会让带阈值门禁的
  // chat_delivery_ms 去测环回：chat-send 全是回声、chat-fan-in 被发送方主导。
  assert.match(source, /sentTexts\.add\(text\)/);
  assert.match(source, /sentTexts\.has\(text\)/);

  // 单账号场景测不到扇出，就不该断言它。
  const chatSend = fs.readFileSync(
    path.join(root, 'load-tests', 'scenarios', 'chat-send.js'),
    'utf8',
  );
  assert.match(chatSend, /measuresDelivery:\s*false/);
});

test('chat sessions surface refused connections instead of reporting unsent', () => {
  const source = fs.readFileSync(
    path.join(root, 'load-tests', 'lib', 'socket-session.js'),
    'utf8',
  );

  // 过期 token 时 WS 升级仍返回 101，升级检查照样过；若不处理 44/41，唯一带着
  // 真实原因的包会被丢掉，结果只剩一堆 'unsent'，把凭据问题伪装成节流问题。
  assert.match(source, /packet\.kind === 'connect-error'/);
  assert.match(source, /packet\.kind === 'disconnected'/);
  assert.match(source, /reason:\s*'server-disconnect'/);
  assert.match(source, /rejected \|\| !connected/);
});

test('the drain window is at least the ack budget it is judged against', () => {
  const source = fs.readFileSync(
    path.join(root, 'load-tests', 'lib', 'socket-session.js'),
    'utf8',
  );
  const thresholds = fs.readFileSync(
    path.join(root, 'load-tests', 'lib', 'thresholds.js'),
    'utf8',
  );

  // 发送循环跑满 durationSeconds。收尾宽限期若短于 ack 预算，最后一批必然被
  // 记成 timeout —— 失败率就掺进了 harness 自己的关闭时机。
  assert.match(thresholds, /export const DEFAULT_ACK_P95_MS = 1500/);
  assert.match(source, /DEFAULT_DRAIN_MS = DEFAULT_ACK_P95_MS \* 2/);
  assert.doesNotMatch(source, /keepOpenMs = 1000/);
  assert.doesNotMatch(source, /keepOpenMs:\s*1000/);
});

test('circle join is REST-based, bounded, and cleans up test memberships', () => {
  const source = fs.readFileSync(
    path.join(root, 'load-tests', 'scenarios', 'circle-join.js'),
    'utf8',
  );
  assert.match(source, /\/circle\/\$\{circleId\}\/join/);
  assert.match(source, /\/circle\/\$\{circleId\}\/leave/);
  assert.match(source, /LOAD_CIRCLE_CLEANUP/);
  assert.match(source, /join_failed/);
});

test('fixture preparation emits metadata only and rejects secrets', () => {
  const source = fs.readFileSync(
    path.join(root, 'scripts', 'prepare-performance-fixture.mjs'),
    'utf8',
  );
  assert.match(source, /LOAD_PERFORMANCE_FIXTURE=true/);
  assert.match(source, /conversationIds/);
  assert.match(source, /accessToken/);
  assert.match(source, /must not be written/i);
});
