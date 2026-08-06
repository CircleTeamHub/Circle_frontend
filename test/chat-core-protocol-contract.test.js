const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 自研聊天协议是 circle-im ↔ circle_be 的跨仓契约:事件名 / ws 路径 /
// 错误码字符串。本文件仿 api-error-localization.test.js:双仓并排检出时
// 与后端源码逐项对齐;仅前端 CI 时跳过跨仓部分。
const root = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const BACKEND_CONSTANTS_PATH = path.join(
  root,
  '..',
  'circle_be',
  'src/chat/chat.constants.ts',
);
const hasBackend = fs.existsSync(BACKEND_CONSTANTS_PATH);

const FE_EVENTS = {
  send: 'chat:send',
  read: 'chat:read',
  typing: 'chat:typing',
  message: 'chat:msg',
};

test('frontend protocol declares the canonical event names and path', () => {
  const protocol = read('src/chat-core/protocol.ts');
  for (const value of Object.values(FE_EVENTS)) {
    assert.match(protocol, new RegExp(`'${value}'`));
  }
  assert.match(protocol, /CHAT_WS_PATH = '\/chat-ws'/);
});

test('socket manager authenticates via handshake auth frame, not the URL', () => {
  const manager = read('src/chat-core/socket-manager.ts');
  assert.match(manager, /auth:\s*\{\s*token\s*\}/);
  assert.doesNotMatch(manager, /[?&]token=/);
  assert.doesNotMatch(manager, /encodeURIComponent\(token\)/);
  // 只走 websocket 传输,禁用 polling(移动端弱网下 polling 只会放大延迟)。
  assert.match(manager, /transports:\s*\['websocket'\]/);
});

test('send path keeps the idempotent delivery id contract', () => {
  const manager = read('src/chat-core/socket-manager.ts');
  // 超时错误保留调用方用同一 d 重发的语义(注释+错误码都在)。
  assert.match(manager, /CHAT_ACK_TIMEOUT/);
  assert.match(manager, /createDeliveryId/);
});

test(
  'event names match the backend gateway constants',
  { skip: !hasBackend && 'circle_be not checked out beside circle-im' },
  () => {
    const backend = fs.readFileSync(BACKEND_CONSTANTS_PATH, 'utf8');
    for (const [key, value] of Object.entries(FE_EVENTS)) {
      const pattern = new RegExp(`${key === 'message' ? 'message' : key}:\\s*'${value}'`);
      assert.match(backend, pattern, `backend missing ${key} = ${value}`);
    }
    assert.match(backend, /CHAT_WS_PATH = '\/chat-ws'/);
  },
);

test(
  'frontend-referenced chat error codes exist in the backend registry',
  { skip: !hasBackend && 'circle_be not checked out beside circle-im' },
  () => {
    const registry = fs.readFileSync(
      path.join(root, '..', 'circle_be', 'src/common/app-error-codes.ts'),
      'utf8',
    );
    // socket-manager 直接引用的服务端错误码(本地合成码 CHAT_NOT_CONNECTED /
    // CHAT_ACK_TIMEOUT 除外 —— 那两个不上行,只在客户端消费)。
    for (const code of ['CHAT_SENSITIVE_WORD_BLOCKED', 'CHAT_INVALID_PAYLOAD']) {
      assert.match(registry, new RegExp(`'${code}'`), `backend missing ${code}`);
    }
  },
);
