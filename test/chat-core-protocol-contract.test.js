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

// CIRCLE_BE_PATH 覆盖给 git worktree 用：worktree 旁边的 ../circle_be 往往不存在或是别的分支。
const BACKEND_ROOT =
  process.env.CIRCLE_BE_PATH ?? path.join(root, '..', 'circle_be');
const BACKEND_CONSTANTS_PATH = path.join(
  BACKEND_ROOT,
  'src/chat/chat.constants.ts',
);
const hasBackend = fs.existsSync(BACKEND_CONSTANTS_PATH);

const FE_EVENTS = {
  send: 'chat:send',
  read: 'chat:read',
  typing: 'chat:typing',
  message: 'chat:msg',
  conversation: 'chat:conversation',
  revoke: 'chat:revoke',
  delivered: 'chat:delivered',
  reaction: 'chat:reaction',
  edit: 'chat:edit',
  historyCleared: 'chat:history_cleared',
  burnedMessages: 'chat:burned_messages',
  // 前后台上报(决定这台设备算不算「收得到」、要不要发推送)与 token 到期通知。
  background: 'chat:background',
  foreground: 'chat:foreground',
  sessionExpired: 'chat:session_expired',
};

test('frontend protocol declares the canonical event names and path', () => {
  const protocol = read('src/chat-core/protocol.ts');
  for (const value of Object.values(FE_EVENTS)) {
    assert.match(protocol, new RegExp(`'${value}'`));
  }
  assert.match(protocol, /CHAT_WS_PATH = '\/chat-ws'/);
  // 服务端没有「成员全局焚毁策略」这个事件（全局阅后即焚只是本人视图上的读过滤）。
  assert.doesNotMatch(protocol, /chat:global_burn_policy/);
});

test('socket manager authenticates via handshake auth frame, not the URL', () => {
  const manager = read('src/chat-core/socket-manager.ts');
  // appState:后台里建立的连接(安卓后台重连)一开始就按后台登记。auth 必须是回调:
  // socket.io 自动重连会原样重发对象形式的 auth,带上的就是建连那一刻的前后台状态。
  assert.match(
    manager,
    /auth:\s*\(sendAuth\)\s*=>\s*\{[\s\S]*?sendAuth\(\{\s*token,\s*traceId:\s*connectionTraceId,\s*appState:\s*handshakeAppState,\s*\.\.\.\(pushToken \? \{ pushToken \} : \{\}\),?\s*\}\)/,
  );
  assert.match(
    manager,
    /extraHeaders:\s*\{\s*'x-connection-trace-id':\s*connectionTraceId\s*\}/,
  );
  assert.doesNotMatch(manager, /[?&]token=/);
  assert.doesNotMatch(manager, /encodeURIComponent\(token\)/);
  // 只走 websocket 传输,禁用 polling(移动端弱网下 polling 只会放大延迟)。
  assert.match(manager, /transports:\s*\['websocket'\]/);
});

test(
  'the handshake auth fields match the backend ChatHandshakeAuth',
  { skip: !hasBackend && 'circle_be not checked out beside circle-im' },
  () => {
    const types = fs.readFileSync(
      path.join(BACKEND_ROOT, 'src/chat/chat.types.ts'),
      'utf8',
    );
    const body = /export interface ChatHandshakeAuth \{([\s\S]*?)\n\}/.exec(types)?.[1];
    assert.ok(body, 'backend ChatHandshakeAuth not found');
    const backendFields = [...body.matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1]).sort();
    const manager = read('src/chat-core/socket-manager.ts');
    const sendAuth = /sendAuth\(\{([\s\S]*?)\}\);/.exec(manager)?.[1] ?? '';
    const frontendFields = [
      ...sendAuth.matchAll(/(?:^|[\s,{])(?:\.\.\.\(\w+ \? \{ )?(\w+)(?=[,:\s}])/g),
    ]
      .map((m) => m[1])
      .filter((name) => !['connectionTraceId', 'handshakeAppState'].includes(name));
    // 字段名是协议:改了一边,另一边读到的永远是 undefined,测试却都是绿的。
    assert.deepEqual([...new Set(frontendFields)].sort(), backendFields);
  },
);

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
      path.join(BACKEND_ROOT, 'src/common/app-error-codes.ts'),
      'utf8',
    );
    // socket-manager 直接引用的服务端错误码(本地合成码 CHAT_NOT_CONNECTED /
    // CHAT_ACK_TIMEOUT 除外 —— 那两个不上行,只在客户端消费)。
    for (const code of [
      'CHAT_SENSITIVE_WORD_BLOCKED',
      'CHAT_INVALID_PAYLOAD',
      'CHAT_MESSAGE_NOT_FOUND',
      'CHAT_REVOKE_WINDOW_EXPIRED',
      'CHAT_REVOKE_FORBIDDEN',
      'CHAT_EDIT_WINDOW_EXPIRED',
      'CHAT_EDIT_FORBIDDEN',
    ]) {
      assert.match(registry, new RegExp(`'${code}'`), `backend missing ${code}`);
    }
  },
);
