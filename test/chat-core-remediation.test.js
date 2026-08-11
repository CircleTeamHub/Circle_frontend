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

// ---- §9 清理批:typing 接线 / 静音横幅 / file 与未知类型渲染 / 失败预览 ----

test('typing flows end to end: throttle-send behind settings, store expiry, header display', () => {
  const screen = read('src/features/chat/screens/ChatDetailScreen.tsx');
  // 发送侧:草稿变化按设置开关门禁上报(单聊/群聊各自的开关)。
  assert.match(screen, /isGroupChat \? typingGroup : typingSingle/);
  assert.match(screen, /sendChatTyping\(conversationID\)/);
  assert.match(screen, /singleTyping/);
  assert.match(screen, /groupTyping/);
  // 显示侧:头部状态优先显示「对方正在输入…」,到期回落在线状态。
  assert.match(screen, /chat\.detail\.statusTyping/);
  const store = read('src/chat-core/store.ts');
  assert.match(store, /typingUntilByConversation/);
  assert.match(store, /applyTyping/);
  assert.match(store, /TYPING_DISPLAY_MS/);
  const dispatcher = read('src/chat-core/dispatcher.ts');
  assert.match(dispatcher, /CHAT_EVENTS\.typing/);
});

test('muted conversations suppress the in-app banner', () => {
  const dispatcher = read('src/chat-core/dispatcher.ts');
  assert.match(dispatcher, /conversation\.muted\) return 'suppressed'/);
});

test('file and unknown message types render placeholders, never blank bubbles', () => {
  const mappers = read('src/chat-core/message-mappers.ts');
  assert.match(mappers, /case 'file'/);
  assert.match(mappers, /im\.preview\.file/);
  assert.match(mappers, /im\.message\.unsupported/);
});

test('conversations with a failed send carry a localized preview prefix', () => {
  const screen = read('src/features/messages/screens/MessagesScreen.tsx');
  assert.match(screen, /im\.preview\.sendFailedPrefix/);
  assert.match(screen, /failedConversationKey/);
});

test('section-9 words exist in every locale', () => {
  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const dict = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    assert.ok(dict?.chat?.detail?.statusTyping, `${locale} statusTyping`);
    assert.ok(dict?.im?.message?.unsupported, `${locale} unsupported`);
    assert.ok(dict?.im?.preview?.sendFailedPrefix, `${locale} sendFailedPrefix`);
  }
});

test('the legacy system-notice dedupe layer is fully gone', () => {
  // 自研栈同好友事件只产生一条系统消息,去重层连同死字段一起删净。
  assert.ok(
    !fs.existsSync(path.join(root, 'src/features/chat/utils/system-notice-dedupe.ts')),
    'system-notice-dedupe.ts should be deleted',
  );
  const types = read('src/types/index.ts');
  assert.ok(!types.includes('systemNoticeKind'), 'dead field systemNoticeKind');
  const screen = read('src/features/chat/screens/ChatDetailScreen.tsx');
  assert.ok(!screen.includes('collapseDuplicateFriendAddedNotices'));
});

// ---- Codex review 批(PR #150):行为回归的源码级契约 ----

test('the app badge retries when setBadgeCountAsync resolves false', () => {
  // 未授权/桌面不支持时这个 API resolve(false) 而不是 reject —— 只在 catch 里
  // 复位的话,用户之后打开权限,图标会一直停在旧值。
  const badge = read('src/chat-core/app-badge.ts');
  assert.match(badge, /applied === false/);
  assert.match(badge, /lastApplied = null/);
});

test('the app badge includes the local mark-as-unread overrides', () => {
  // 滑动「标记为未读」只改本地覆盖 store —— 不订阅它的话 tab 上有红点、
  // 图标角标是 0,而且此后再也不会自己对上。
  const badge = read('src/chat-core/app-badge.ts');
  assert.match(badge, /useLocalUnreadStore\.subscribe/);
  assert.match(badge, /countLocalUnreadOverrides/);
});

test('the delivered watermark is coalesced, not just deduped', () => {
  // 每条新消息的 height 都更高,所以「只挡重复或更低」等于一条都挡不住:
  // 群里一次消息洪峰会变成 N 人 × M 条的上行风暴。
  const manager = read('src/chat-core/socket-manager.ts');
  assert.match(manager, /deliveredPending/);
  assert.match(manager, /flushDelivered/);
});

test('the reconnect judgement survives a token-rotation socket swap', () => {
  const manager = read('src/chat-core/socket-manager.ts');
  assert.match(manager, /hadConnectedForUser/);
  // 登出/换号要复位,新账号的第一次连接是首连。
  assert.match(manager, /hadConnectedForUser = null/);
});

test('offline revocations get their own catch-up channel', () => {
  // 撤回不改 height —— afterHeight 补拉结构上永远看不到它。
  const api = read('src/chat-core/api.ts');
  assert.match(api, /\/chat\/messages\/mutations/);
  const manager = read('src/chat-core/socket-manager.ts');
  assert.match(manager, /fetchChatMutationsSince/);
});

test('the local cache is disabled when SQLCipher is unavailable', () => {
  // 明文落一个装着私聊正文的库文件,之后重建也不会追溯加密。
  const db = read('src/chat-core/local-db.ts');
  assert.match(db, /local cache disabled/);
  assert.match(db, /if \(!encrypted\)/);
});

test('message upserts keep the FTS index in sync (no orphan shadow rows)', () => {
  // INSERT OR REPLACE = DELETE + INSERT,而隐式 DELETE 不触发 messages_fts_ad。
  const db = read('src/chat-core/local-db.ts');
  assert.match(db, /ON CONFLICT\(id\) DO UPDATE SET/);
  assert.ok(
    !/INSERT OR REPLACE INTO messages\b/.test(db),
    'INSERT OR REPLACE orphans FTS rows',
  );
});

test('revoke/edit rejections are localized instead of shown raw', () => {
  const sendErrors = read('src/chat-core/send-errors.ts');
  for (const code of [
    'CHAT_REVOKE_WINDOW_EXPIRED',
    'CHAT_REVOKE_FORBIDDEN',
    'CHAT_EDIT_WINDOW_EXPIRED',
    'CHAT_EDIT_FORBIDDEN',
    'CHAT_MESSAGE_NOT_FOUND',
  ]) {
    assert.match(sendErrors, new RegExp(`'${code}'`), `missing ${code}`);
  }
  const screen = read('src/features/chat/screens/ChatDetailScreen.tsx');
  // 撤回失败抛的是 ChatSendError(ack 通道),getApiErrorMessage 认不出它。
  assert.ok(
    !/revokeFailed[\s\S]{0,120}getApiErrorMessage/.test(screen),
    'revoke failures must not go through getApiErrorMessage',
  );
});

test('multi-option pickers do not rely on Alert (Android caps at 3 buttons)', () => {
  const detail = read('src/features/chat/screens/ChatDetailScreen.tsx');
  const info = read('src/features/chat/screens/ChatInfoScreen.tsx');
  assert.match(detail, /OptionPickerSheet/);
  assert.match(info, /OptionPickerSheet/);
});

test('clear-all-chats loads the authoritative conversation list first', () => {
  // store 里那份可能是空的(消息 tab 从没打开过)或缺了隐藏的会话 ——
  // 那些会话一条水位都没写,却照样报「已清空」。
  const actions = read('src/features/profile/hooks/use-storage-actions.ts');
  assert.match(actions, /loadChatConversations\(\)/);
  assert.match(actions, /resetForLogout/);
});

test('swipe delete sequences hide-after-clear and surfaces failures', () => {
  const screen = read('src/features/messages/screens/MessagesScreen.tsx');
  assert.match(screen, /await clearChatConversationHistory/);
  assert.match(screen, /await updateChatConversationPreferences/);
  // 只在 __DEV__ 里 console.warn 等于静默失败。
  assert.match(screen, /messages\.deleteChat[\s\S]{0,200}getApiErrorMessage/);
});

test('reader receipts disclose the 200-reader cap', () => {
  const screen = read('src/features/chat/screens/ChatDetailScreen.tsx');
  assert.match(screen, /readersMore/);
  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const dict = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    assert.ok(dict?.chat?.messageActions?.readersMore, `${locale} readersMore`);
  }
});

test('local-first search merges the server results instead of suppressing them', () => {
  // 本地库每会话只留 500 条,没打开过的会话一条都没有:一条本地命中不该
  // 让整个在线搜索被跳过。
  const api = read('src/chat-core/api.ts');
  assert.match(api, /mergeSearchHits/);
  assert.ok(
    !/if \(local\.length > 0\) return local;/.test(api),
    'a local hit must not suppress the server search',
  );
});

// ---- Codex review 第二轮(PR #150) ----

test('the mutation cursor is persisted and seeded before the first outage', () => {
  // 首次重连时游标若还是 null,代码会「以现在为起点」问一遍 —— 那次断线里
  // 发生的撤回被整段跳过,而 height 没变,任何补拉都够不着它。
  const manager = read('src/chat-core/socket-manager.ts');
  assert.match(manager, /MUTATION_CURSOR_KEY/);
  assert.match(manager, /readMutationCursor/);
  assert.match(manager, /writeMutationCursor/);
});

test('mutation catch-up follows hasMore instead of stopping at one page', () => {
  const manager = read('src/chat-core/socket-manager.ts');
  assert.match(manager, /result\.hasMore/);
  assert.match(manager, /result\.nextSince/);
  const api = read('src/chat-core/api.ts');
  // 用 serverTime 前进会跳过被截断的那些变更。
  assert.ok(
    !/return result\.serverTime;/.test(api),
    'the cursor must come from nextSince, not serverTime',
  );
});

test('an already-hydrated timeline still reconciles the height gap', () => {
  // 冷启动水合之后内存非空,原来的判据让 localMax 恒为 0,缺口对账整个被跳过。
  const api = read('src/chat-core/api.ts');
  assert.match(api, /const inMemory = store\.messagesByConversation/);
});

test('local search hits reach the screen before the server round-trip', () => {
  const api = read('src/chat-core/api.ts');
  assert.match(api, /onLocalResults\?\.\(local\)/);
  const screen = read('src/features/search/screens/SearchScreen.tsx');
  assert.match(screen, /searchAllChatMessagesLocalFirst\(keyword, 50, \(local\)/);
});

test('group typing is actually rendered, not just broadcast', () => {
  const screen = read('src/features/chat/screens/ChatDetailScreen.tsx');
  assert.match(screen, /statusTypingGroup/);
  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const dict = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    assert.ok(dict?.chat?.detail?.statusTypingGroup, `${locale} statusTypingGroup`);
  }
});

test('the mutation cursor is a composite (time, id) keyset', () => {
  // DateTime 只有毫秒精度:一批同毫秒的变更跨在页边界上时,只带时间戳的游标
  // 配 `> from` 会把剩下那些同刻的行永久跳过。
  const protocol = read('src/chat-core/protocol.ts');
  assert.match(protocol, /nextSinceId/);
  const manager = read('src/chat-core/socket-manager.ts');
  assert.match(manager, /result\.nextSinceId/);
});

test('an expired mutation cursor drops the cache instead of faking a catch-up', () => {
  const manager = read('src/chat-core/socket-manager.ts');
  assert.match(manager, /resetRequired/);
  assert.match(manager, /dropAllLocalMessages/);
  const db = read('src/chat-core/local-db.ts');
  assert.match(db, /export async function dropAllLocalMessages/);
  // web 平台桩要同步导出面,否则 expo export --platform web 会红。
  const web = read('src/chat-core/local-db.web.ts');
  assert.match(web, /dropAllLocalMessages/);
});

// ---- Codex review 第四轮(PR #153):只修 P1(§12.5 收口规则) ----

test('clearing a conversation also drops its queued sends', () => {
  // 只删 messages 的话,那条私信正文原样留在 outbox 里,而且下次冷启动
  // hydrateFromLocalDb 会把它当「发送失败」气泡还原出来 —— 清空既没清干净
  // 也没清住。
  const db = read('src/chat-core/local-db.ts');
  const clearFn = db.slice(
    db.indexOf('export async function clearLocalConversationMessages'),
    db.indexOf('export async function purgeExpiredLocalMessages'),
  );
  assert.match(clearFn, /DELETE FROM outbox WHERE conversation_id = \?/);
});

test('burn-expired messages are purged from the local cache', () => {
  // 服务端 sweeper 物删之后本地无从得知(没有到期元数据、没有删除事件),
  // 不主动清的话冷启动水合与本地 FTS 仍然能把本该烧掉的正文端出来。
  const db = read('src/chat-core/local-db.ts');
  assert.match(db, /export async function purgeExpiredLocalMessages/);
  const web = read('src/chat-core/local-db.web.ts');
  assert.match(web, /purgeExpiredLocalMessages/);
  const store = read('src/chat-core/store.ts');
  assert.match(store, /purgeExpiredBurnMessages/);
  // 三个触发点:拿到会话快照、档位变更、冷启动水合。
  const calls = store.match(/get\(\)\.purgeExpiredBurnMessages\(\)/g) ?? [];
  assert.ok(calls.length >= 3, `expected >=3 purge triggers, got ${calls.length}`);
});

test('burn expiry is scheduled and self-destruct images avoid disk caching', () => {
  const store = read('src/chat-core/store.ts');
  assert.match(store, /scheduleNextBurnPurge/);
  const image = read('src/features/chat/components/bubbles/image-bubble.tsx');
  assert.match(image, /cachePolicy=\{selfDestructEnabled \? 'memory' : 'memory-disk'\}/);
});

test('clear-all reports partial failure instead of claiming success', () => {
  // allSettled 把 rejection 全吞了、照样弹「已全部清空」:那些没清成的会话
  // 服务端历史还在,下次加载就整段回来。
  const actions = read('src/features/profile/hooks/use-storage-actions.ts');
  assert.match(actions, /o\.status === 'rejected'/);
  assert.match(actions, /clearAllChatsPartialTitle/);
  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const dict = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    assert.ok(
      dict?.settingsDetails?.storage?.clearAllChatsPartialTitle,
      `${locale} clearAllChatsPartialTitle`,
    );
    assert.ok(
      dict?.settingsDetails?.storage?.clearAllChatsPartialMessage,
      `${locale} clearAllChatsPartialMessage`,
    );
  }
});
