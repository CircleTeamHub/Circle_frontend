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

// ---- 批2:撤回 + 真引用(G-02 / G-09) ----

test('protocol declares chat:revoke, revoke fields and the replyTo snapshot', () => {
  const protocol = read('src/chat-core/protocol.ts');
  assert.match(protocol, /revoke: 'chat:revoke'/);
  assert.match(protocol, /ChatRevokeBroadcast/);
  assert.match(protocol, /ChatReplyToSnapshot/);
  assert.match(protocol, /revokedAt\?/);
});

test('store applyRevoke clears content, keeps height slot and flips replyTo snapshots', () => {
  const store = read('src/chat-core/store.ts');
  assert.match(store, /applyRevoke/);
  // 引用了被撤回消息的那些气泡要同步翻成「消息已撤回」
  assert.match(store, /replyTo\?\.id === messageId/);
});

test('revoked messages render as a localized gray pill, not an empty bubble', () => {
  const mappers = read('src/chat-core/message-mappers.ts');
  assert.match(mappers, /revokedBySelf/);
  assert.match(mappers, /revokedByOther/);
  const preview = read('src/chat-core/mappers.ts');
  assert.match(preview, /tPreview\('revoked'/);
});

test('quote bubbles consume the replyTo snapshot and expose jump coordinates', () => {
  const mappers = read('src/chat-core/message-mappers.ts');
  assert.match(mappers, /quoteMessageId/);
  assert.match(mappers, /revokedQuote/);
});

test('revoke words exist in every locale', () => {
  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const dict = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    assert.ok(dict?.im?.message?.revokedBySelf, `${locale} im.message.revokedBySelf`);
    assert.ok(dict?.im?.preview?.revoked, `${locale} im.preview.revoked`);
    assert.ok(dict?.chat?.messageActions?.revoke, `${locale} chat.messageActions.revoke`);
    for (const code of [
      'CHAT_MESSAGE_NOT_FOUND',
      'CHAT_REVOKE_WINDOW_EXPIRED',
      'CHAT_REVOKE_FORBIDDEN',
    ]) {
      assert.ok(dict?.serverErrors?.[code], `${locale} serverErrors.${code}`);
    }
  }
});

// ---- 批3:会话级阅后即焚(S-01)+ 清空聊天记录(G-14) ----

test('conversation dto carries the burn duration and api exposes both endpoints', () => {
  const protocol = read('src/chat-core/protocol.ts');
  assert.match(protocol, /burnDurationSec/);
  const api = read('src/chat-core/api.ts');
  assert.match(api, /setChatBurnDuration/);
  assert.match(api, /clearChatConversationHistory/);
  assert.match(api, /\/burn/);
  assert.match(api, /\/clear/);
});

test('clearing a conversation empties the local timeline, preview and unread', () => {
  const store = read('src/chat-core/store.ts');
  assert.match(store, /clearConversationLocal/);
  assert.match(store, /applyBurnDuration/);
});

test('burn toggle leaves a localized system trail and the info rows exist', () => {
  const mappers = read('src/chat-core/message-mappers.ts');
  assert.match(mappers, /burn-changed/);
  assert.match(mappers, /formatBurnDuration/);
  const info = read('src/features/chat/screens/ChatInfoScreen.tsx');
  assert.match(info, /handleOpenBurnOptions/);
  assert.match(info, /handleClearHistory/);
});

test('swipe delete clears the personal history watermark, not just hides', () => {
  const screen = read('src/features/messages/screens/MessagesScreen.tsx');
  assert.match(screen, /clearChatConversationHistory/);
});

test('the settings clear-all path writes server watermarks before wiping cache', () => {
  const hook = read('src/features/profile/hooks/use-storage-actions.ts');
  assert.match(hook, /clearChatConversationHistory/);
  assert.match(hook, /allSettled/);
});

test('burn words exist in every locale', () => {
  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const dict = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    assert.ok(dict?.im?.notification?.burnEnabled, `${locale} burnEnabled`);
    assert.ok(dict?.im?.notification?.burnDisabled, `${locale} burnDisabled`);
    assert.ok(dict?.im?.burn?.h1, `${locale} im.burn.h1`);
    assert.ok(dict?.chat?.burnAfterReading, `${locale} chat.burnAfterReading`);
    assert.ok(dict?.chat?.clearHistory, `${locale} chat.clearHistory`);
  }
});

// ---- 批1:SQLite 本地持久化(G-01/G-03/G-10) ----

test('local db module covers the five persistence surfaces with graceful degradation', () => {
  const db = read('src/chat-core/local-db.ts');
  for (const table of ['conversations', 'messages', 'sync_state', 'outbox', 'pending_reads']) {
    assert.match(db, new RegExp(table));
  }
  assert.match(db, /fts5/);
  assert.match(db, /PRAGMA key/);
  // 本地库是缓存:任何失败都必须吞掉降级,绝不打断聊天主链路
  assert.match(db, /running without local cache/);
});

test('the sqlite plugin ships with SQLCipher enabled', () => {
  const appConfig = JSON.parse(read('app.json'));
  const plugins = appConfig?.expo?.plugins ?? [];
  const entry = plugins.find(
    (p) => Array.isArray(p) && p[0] === 'expo-sqlite',
  );
  assert.ok(entry, 'expo-sqlite plugin missing');
  assert.equal(entry[1]?.useSQLCipher, true);
});

test('the single ingest entry persists to the local db', () => {
  const store = read('src/chat-core/store.ts');
  assert.match(store, /persistLocalMessages\(conversationId, incoming\)/);
  assert.match(store, /persistLocalConversations/);
  assert.match(store, /hydrateLocalSnapshot/);
});

test('cold start hydrates conversations, outbox and pending reads before the network', () => {
  const manager = read('src/chat-core/socket-manager.ts');
  assert.match(manager, /hydrateFromLocalDb/);
  assert.match(manager, /outboxList/);
  assert.match(manager, /pendingReadsList/);
  assert.match(manager, /pendingReadUpsert/);
});

test('history reads local-first and repairs holes against the newest page', () => {
  const api = read('src/chat-core/api.ts');
  assert.match(api, /readRecentLocalMessages/);
  assert.match(api, /LOCAL_HOLE_BACKFILL_MAX/);
  assert.match(api, /deleteLocalMessagesBelow/);
});

test('global search prefers local FTS with a server fallback', () => {
  const api = read('src/chat-core/api.ts');
  assert.match(api, /searchAllChatMessagesLocalFirst/);
  const screen = read('src/features/search/screens/SearchScreen.tsx');
  assert.match(screen, /searchAllChatMessagesLocalFirst/);
});

test('failed sends survive restarts via the outbox and expose a resend action', () => {
  const client = read('src/chat-core/client.ts');
  assert.match(client, /outboxUpsert/);
  assert.match(client, /retryFailedChatMessage/);
  const screen = read('src/features/chat/screens/ChatDetailScreen.tsx');
  assert.match(screen, /retryFailedChatMessage/);
  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const dict = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    assert.ok(dict?.chat?.messageActions?.resend, `${locale} resend`);
  }
});

test('the tab red dot follows the same total as the app badge (G-10)', () => {
  const badge = read('src/chat-core/app-badge.ts');
  assert.match(badge, /setMessagesUnread/);
});

// ---- 批5:送达/回应/编辑/逐条已读(G-07) ----

test('protocol declares the delivered/reaction/edit events and reaction whitelist', () => {
  const protocol = read('src/chat-core/protocol.ts');
  for (const ev of ["'chat:delivered'", "'chat:reaction'", "'chat:edit'"]) {
    assert.match(protocol, new RegExp(ev));
  }
  assert.match(protocol, /CHAT_REACTION_EMOJIS/);
});

test('receiving a foreign message reports the delivered watermark', () => {
  const dispatcher = read('src/chat-core/dispatcher.ts');
  assert.match(dispatcher, /reportChatDelivered/);
});

test('store lands delivered/reaction/edit updates', () => {
  const store = read('src/chat-core/store.ts');
  assert.match(store, /applyDelivered/);
  assert.match(store, /applyReaction/);
  assert.match(store, /applyEdit/);
});

test('batch-5 words exist in every locale', () => {
  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const dict = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    assert.ok(dict?.chat?.message?.delivered, `${locale} delivered`);
    assert.ok(dict?.chat?.messageActions?.react, `${locale} react`);
    assert.ok(dict?.serverErrors?.CHAT_EDIT_WINDOW_EXPIRED, `${locale} edit window`);
    assert.ok(dict?.serverErrors?.CHAT_EDIT_FORBIDDEN, `${locale} edit forbidden`);
  }
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
