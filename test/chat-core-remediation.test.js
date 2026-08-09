const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// remediation 批0/0.5 的源码断言(风格同 chat-core-protocol-contract.test.js):
// G-11/S-02 chat:conversation 消费、G-13 重连对账、G-15 多端未读、G-18 图标角标。
const root = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

// ---- 批0:chat:conversation 消费(G-11/S-02 客户端半) ----

test('protocol declares chat:conversation and its payload type', () => {
  const protocol = read('src/chat-core/protocol.ts');
  assert.match(protocol, /conversation: 'chat:conversation'/);
  assert.match(protocol, /ChatConversationBroadcast/);
  assert.match(protocol, /ChatConversationChangeKind/);
  for (const kind of ['joined', 'left', 'removed', 'updated']) {
    assert.match(protocol, new RegExp(`'${kind}'`), `missing kind ${kind}`);
  }
});

test('dispatcher removes the conversation and guards against resurrection', () => {
  const dispatcher = read('src/chat-core/dispatcher.ts');
  assert.match(dispatcher, /CHAT_EVENTS\.conversation/);
  // removed/left → 从列表收走
  assert.match(dispatcher, /removeConversation\(/);
  // 防复活:被移除会话的迟到 chat:msg 不得再触发补拉把它带回列表
  assert.match(dispatcher, /removedConversations/);
  // joined → 解除防复活标记并补拉元信息(重新入群要能回来)
  assert.match(dispatcher, /removedConversations\.delete\(/);
});

test('being removed from the active conversation surfaces a localized notice', () => {
  const dispatcher = read('src/chat-core/dispatcher.ts');
  assert.match(dispatcher, /im\.conversation\.removedFromGroup/);
});

test('removed-from-group notice exists in every locale', () => {
  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const dict = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    const value = dict?.im?.conversation?.removedFromGroup;
    assert.ok(
      typeof value === 'string' && value.length > 0,
      `${locale} missing im.conversation.removedFromGroup`,
    );
  }
});

// ---- 批0.5:重连对账(G-13 客户端半) ----

test('history page type carries the afterHeight cursor', () => {
  const protocol = read('src/chat-core/protocol.ts');
  assert.match(protocol, /nextAfterHeight/);
});

test('api pulls forward incrementally with afterHeight and loops the cursor', () => {
  const api = read('src/chat-core/api.ts');
  assert.match(api, /backfillConversationSince/);
  assert.match(api, /afterHeight/);
  assert.match(api, /nextAfterHeight/);
  // 与 chat:msg 同一入库入口,height 幂等去重
  assert.match(api, /ingestMessages\(conversationId/);
});

test('reconnect refreshes conversations and backfills the open conversation gap', () => {
  const manager = read('src/chat-core/socket-manager.ts');
  // 首连不做(冷启动全量拉取由页面负责),重连才对账
  assert.match(manager, /hadConnected/);
  assert.match(manager, /loadChatConversations/);
  assert.match(manager, /backfillConversationSince/);
});

// ---- G-15:多端已读收敛未读 ----

test('own read watermark from another device converges the unread badge', () => {
  const store = read('src/chat-core/store.ts');
  assert.match(store, /userId === currentUserId/);
  // 只收敛不增长:min(现值, max(0, latest - read))
  assert.match(store, /Math\.min\(\s*target\.unreadCount/);
});

// ---- G-18:图标角标轻方案 ----

test('app icon badge follows the muted-aware total unread', () => {
  const badge = read('src/chat-core/app-badge.ts');
  assert.match(badge, /setBadgeCountAsync/);
  assert.match(badge, /selectTotalUnread/);
  // 幂等安装 + 失败重试语义
  assert.match(badge, /installed/);
});

test('badge sync is wired into the chat connect path', () => {
  const manager = read('src/chat-core/socket-manager.ts');
  assert.match(manager, /initChatAppBadgeSync\(\)/);
});
