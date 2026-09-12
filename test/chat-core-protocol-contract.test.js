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
  conversation: 'chat:conversation',
  revoke: 'chat:revoke',
  delivered: 'chat:delivered',
  reaction: 'chat:reaction',
  edit: 'chat:edit',
  historyCleared: 'chat:history_cleared',
  globalBurnPolicy: 'chat:global_burn_policy',
  burnedMessages: 'chat:burned_messages',
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
  assert.match(manager, /auth:\s*\{\s*token,\s*traceId:\s*connectionTraceId\s*\}/);
  assert.match(
    manager,
    /extraHeaders:\s*\{\s*'x-connection-trace-id':\s*connectionTraceId\s*\}/,
  );
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

/**
 * 等后端那一半落地的事件(棘轮:只能变短,不能变长)。
 *
 * 阅后即焚的全局策略与焚毁通知,前端这一半在 feat/group-chat-inbox 上,后端那一半
 * 在 circle_be 的 `d252537`(群设置第二批的未推送收尾提交)里 —— 它改了 34 个文件、
 * 跨 chat/group/notification/privacy,不属于任何一条在跑的分支,所以不能顺手搬进来。
 *
 * 下面那条用例会**反向**断言后端确实还没有这两个常量:后端一落地,它立刻变红并让你
 * 把这里删掉。所以这不是一个永久的洞,而是一张会自己催着还的欠条。
 */
const BACKEND_PENDING_EVENTS = new Set(['globalBurnPolicy', 'burnedMessages']);

test(
  'event names match the backend gateway constants',
  { skip: !hasBackend && 'circle_be not checked out beside circle-im' },
  () => {
    const backend = fs.readFileSync(BACKEND_CONSTANTS_PATH, 'utf8');
    for (const [key, value] of Object.entries(FE_EVENTS)) {
      if (BACKEND_PENDING_EVENTS.has(key)) continue;
      const pattern = new RegExp(`${key === 'message' ? 'message' : key}:\\s*'${value}'`);
      assert.match(backend, pattern, `backend missing ${key} = ${value}`);
    }
    assert.match(backend, /CHAT_WS_PATH = '\/chat-ws'/);
  },
);

test(
  'the pending-event allowance shrinks the moment the backend half lands',
  { skip: !hasBackend && 'circle_be not checked out beside circle-im' },
  () => {
    const backend = fs.readFileSync(BACKEND_CONSTANTS_PATH, 'utf8');
    for (const key of BACKEND_PENDING_EVENTS) {
      const value = FE_EVENTS[key];
      assert.doesNotMatch(
        backend,
        new RegExp(`${key}:\\s*'${value}'`),
        `circle_be 现在已经有 ${key} = ${value} 了 —— 把它从 BACKEND_PENDING_EVENTS 里删掉,让上面那条用例重新守住它`,
      );
    }
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
