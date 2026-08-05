const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadListenersHarness() {
  const filePath = path.join(process.cwd(), 'src/im/listeners.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      baseUrl: process.cwd(),
      paths: { '@/*': ['src/*'] },
    },
    fileName: filePath,
  }).outputText;

  const handlers = new Map();
  const offCalls = [];
  const timers = [];
  const appendCalls = [];
  const markReadCalls = [];
  const mergeConversationCalls = [];
  const setTotalUnreadCalls = [];
  const badgeUnreadCalls = [];
  const markReadIdCalls = [];
  const snackbarConversationLists = [];
  const setConnectedCalls = [];
  const setErrorCalls = [];
  const recoverCalls = [];
  const cancelRecoveryCalls = [];
  const clearRetryCalls = [];
  const state = {
    activeConversation: {
      conversationID: 'conv-1',
      sourceID: 'group-1',
      sessionType: 2,
    },
    currentUserID: 'self',
    conversations: [],
    appendMessages: (conversationID, messages) => {
      appendCalls.push([conversationID, messages]);
    },
    setConnecting: () => {},
    setConnected: (value) => setConnectedCalls.push(value),
    setError: (value) => setErrorCalls.push(value),
    setConversations: () => {},
    mergeConversations: (conversations) => {
      mergeConversationCalls.push(conversations);
    },
    setTotalUnread: (total) => setTotalUnreadCalls.push(total),
    markMessagesRead: (conversationID, ids) => {
      markReadIdCalls.push([conversationID, ids]);
    },
    setUserOnlineStatuses: () => {},
  };
  const OpenIMSDK = {
    on: (event, handler) => handlers.set(event, handler),
    off: (event, handler) => offCalls.push([event, handler]),
    getConversationListSplit: async () => [],
    markConversationMessageAsRead: async (conversationID) => {
      markReadCalls.push(conversationID);
    },
  };

  const context = {
    module: { exports: {} },
    exports: {},
    __DEV__: false,
    setTimeout: (callback, delay) => {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => {
      timer.cleared = true;
    },
    require: (request) => {
      if (request === '@openim/rn-client-sdk') {
        return {
          __esModule: true,
          default: OpenIMSDK,
          SessionType: { Single: 1, Group: 2 },
        };
      }
      if (request === 'expo-router') {
        return { router: { replace: () => {} } };
      }
      if (request === '@/i18n') {
        return {
          __esModule: true,
          default: { t: (_key, fallback) => fallback },
        };
      }
      if (request === '@/services/auth/session') {
        return { clearLocalSession: async () => undefined };
      }
      if (request === '@/im/token-recovery') {
        return {
          registerIMLoginExecutor: () => {},
    registerIMLogoutExecutor: () => {},
          recoverIMSession: async () => {
            recoverCalls.push(1);
            return false;
          },
          cancelIMSessionRecovery: () => cancelRecoveryCalls.push(1),
          isIMReloginPending: () => false,
        };
      }
      if (request === '@/im/login-retry-pending') {
        return {
          clearIMLoginRetryPending: () => clearRetryCalls.push(1),
          markIMLoginRetryPending: () => {},
          isIMLoginRetryPending: () => false,
        };
      }
      if (request === '@/im/snackbar') {
        return {
          buildChatSnackbar: (_message, conversations) => {
            snackbarConversationLists.push(conversations);
            return null;
          },
        };
      }
      if (
        request ===
        '@/features/notifications/store/use-notification-snackbar-store'
      ) {
        return {
          useNotificationSnackbarStore: {
            getState: () => ({ enqueueChatMessage: () => {} }),
          },
        };
      }
      if (request === '@/stores/imStore') {
        return { useIMStore: { getState: () => state } };
      }
      if (request === '@/stores/tabBadgeStore') {
        return {
          useTabBadgeStore: {
            getState: () => ({
              setMessagesUnread: (total) => badgeUnreadCalls.push(total),
            }),
          },
        };
      }
      throw new Error(`Unexpected import: ${request}`);
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return {
    ...context.module.exports,
    handlers,
    timers,
    appendCalls,
    markReadCalls,
    offCalls,
    state,
    setConnectedCalls,
    setErrorCalls,
    recoverCalls,
    cancelRecoveryCalls,
    clearRetryCalls,
    mergeConversationCalls,
    setTotalUnreadCalls,
    badgeUnreadCalls,
    markReadIdCalls,
    snackbarConversationLists,
  };
}

test('bindOpenIMListeners batches active-conversation messages until the flush timer fires', () => {
  const harness = loadListenersHarness();
  harness.bindOpenIMListeners();
  const handleNewMessages = harness.handlers.get('onRecvNewMessages');
  const first = { clientMsgID: 'm1', groupID: 'group-1', sessionType: 2 };
  const second = { clientMsgID: 'm2', groupID: 'group-1', sessionType: 2 };

  handleNewMessages([first]);
  handleNewMessages([second]);

  assert.equal(harness.appendCalls.length, 0);
  assert.equal(harness.timers.length, 1);
  assert.equal(harness.timers[0].delay, 120);

  harness.timers[0].callback();

  assert.equal(harness.appendCalls.length, 1);
  assert.equal(harness.appendCalls[0][0], 'conv-1');
  assert.equal(harness.appendCalls[0][1].length, 2);
  assert.equal(harness.appendCalls[0][1][0], first);
  assert.equal(harness.appendCalls[0][1][1], second);
  // 用户正停留在该会话：flush 落库后对活跃会话标记一次已读，清未读 + 回执。
  assert.deepEqual(harness.markReadCalls, ['conv-1']);
});

test('bindOpenIMListeners flushes pending active-conversation messages on unbind', () => {
  const harness = loadListenersHarness();
  const unbind = harness.bindOpenIMListeners();
  const handleNewMessages = harness.handlers.get('onRecvNewMessages');
  const message = { clientMsgID: 'm1', groupID: 'group-1', sessionType: 2 };

  handleNewMessages([message]);
  assert.equal(harness.appendCalls.length, 0);

  unbind();

  assert.equal(harness.timers[0].cleared, true);
  assert.equal(harness.appendCalls.length, 1);
  assert.equal(harness.appendCalls[0][0], 'conv-1');
  assert.equal(harness.appendCalls[0][1].length, 1);
  assert.equal(harness.appendCalls[0][1][0], message);
  // unbind 前 flush 也会对仍活跃的会话标记已读。
  assert.deepEqual(harness.markReadCalls, ['conv-1']);
});

test('does not mark read when the user left the conversation before flush', () => {
  const harness = loadListenersHarness();
  harness.bindOpenIMListeners();
  const handleNewMessages = harness.handlers.get('onRecvNewMessages');
  const message = { clientMsgID: 'm1', groupID: 'group-1', sessionType: 2 };

  handleNewMessages([message]);
  // 用户在 120ms flush 窗口内离开了该会话页（activeConversation 被清空）。
  harness.state.activeConversation = null;

  harness.timers[0].callback();

  // 消息仍落库（避免丢消息），但不再标记已读——用户已经不在看了。
  assert.equal(harness.appendCalls.length, 1);
  assert.deepEqual(harness.markReadCalls, []);
});

test('conversation events are batched into one merge, keeping only the latest per conversation', () => {
  const harness = loadListenersHarness();
  harness.bindOpenIMListeners();
  const handleChanged = harness.handlers.get('onConversationChanged');

  // 刷屏时每条消息都会带来一次 conversationChanged（未读 + 最新消息都变）。
  // 逐条处理 = 每条消息一次全量 Map 重建 + 排序 + 一次 zustand 通知。
  handleChanged([{ conversationID: 'conv-1', latestMsgSendTime: 1 }]);
  handleChanged([{ conversationID: 'conv-1', latestMsgSendTime: 2 }]);
  handleChanged([{ conversationID: 'conv-2', latestMsgSendTime: 3 }]);
  handleChanged([{ conversationID: 'conv-1', latestMsgSendTime: 4 }]);

  assert.equal(harness.mergeConversationCalls.length, 0, 'must not merge before the flush');
  assert.equal(harness.timers.length, 1);

  harness.timers[0].callback();

  // 四次事件压成一次 merge。
  assert.equal(harness.mergeConversationCalls.length, 1);
  const merged = harness.mergeConversationCalls[0];
  assert.equal(merged.length, 2, 'one entry per conversation, not per event');

  // 折叠必须保留每个会话的最后一次状态 —— mergeConversationList 本就是按 ID 整体
  // 替换，所以丢掉中间态与逐条 merge 结果等价；丢掉最后一态则是真丢数据。
  const byId = Object.fromEntries(merged.map((c) => [c.conversationID, c]));
  assert.equal(byId['conv-1'].latestMsgSendTime, 4);
  assert.equal(byId['conv-2'].latestMsgSendTime, 3);
});

test('unread events collapse to the latest absolute total, including zero', () => {
  const harness = loadListenersHarness();
  harness.bindOpenIMListeners();
  const handleUnread = harness.handlers.get('onTotalUnreadMessageCountChanged');

  handleUnread(5);
  handleUnread(9);
  handleUnread(12);

  assert.deepEqual(harness.setTotalUnreadCalls, [], 'must not write before the flush');

  harness.timers[0].callback();

  // 未读是服务端下发的绝对总数，不是增量：后值覆盖前值无损。
  assert.deepEqual(harness.setTotalUnreadCalls, [12]);
  assert.deepEqual(harness.badgeUnreadCalls, [12]);

  // 0 是合法的未读数（全部已读），不能被当成「本轮无事件」而丢掉 ——
  // 丢了就会留下一个永远清不掉的红点。
  handleUnread(0);
  harness.timers[1].callback();
  assert.deepEqual(harness.setTotalUnreadCalls, [12, 0]);
  assert.deepEqual(harness.badgeUnreadCalls, [12, 0]);
});

test('messages, conversations and unread share one flush timer', () => {
  const harness = loadListenersHarness();
  harness.bindOpenIMListeners();

  harness.handlers.get('onRecvNewMessages')([
    { clientMsgID: 'm1', groupID: 'group-1', sessionType: 2 },
  ]);
  harness.handlers.get('onConversationChanged')([{ conversationID: 'conv-1' }]);
  harness.handlers.get('onTotalUnreadMessageCountChanged')(3);

  // 共用一个定时器：三个缓冲在同一个 tick 落 store，React 合成一次渲染。
  // 三个各自的定时器会错开触发 = 三次渲染，正是刷屏时要避免的。
  assert.equal(harness.timers.length, 1, 'expected a single shared flush timer');

  harness.timers[0].callback();

  assert.equal(harness.appendCalls.length, 1);
  assert.equal(harness.mergeConversationCalls.length, 1);
  assert.deepEqual(harness.setTotalUnreadCalls, [3]);
});

test('a message flood produces flushes, not per-event store writes', () => {
  const harness = loadListenersHarness();
  harness.bindOpenIMListeners();
  const handleNewMessages = harness.handlers.get('onRecvNewMessages');
  const handleChanged = harness.handlers.get('onConversationChanged');
  const handleUnread = harness.handlers.get('onTotalUnreadMessageCountChanged');

  // 模拟恶意刷屏：200 条消息，每条都带一次会话变更和一次未读变更。
  for (let i = 0; i < 200; i += 1) {
    handleNewMessages([
      { clientMsgID: `m${i}`, groupID: 'group-1', sessionType: 2 },
    ]);
    handleChanged([{ conversationID: 'conv-1', latestMsgSendTime: i }]);
    handleUnread(i);
  }

  // 600 次事件在一个 flush 窗口内 = 1 个定时器、0 次 store 写入。
  assert.equal(harness.timers.length, 1);
  assert.equal(harness.appendCalls.length, 0);
  assert.equal(harness.mergeConversationCalls.length, 0);
  assert.equal(harness.setTotalUnreadCalls.length, 0);

  harness.timers[0].callback();

  // flush 后各自恰好一次写入，且消息一条不丢。
  assert.equal(harness.appendCalls.length, 1);
  assert.equal(harness.appendCalls[0][1].length, 200, 'no message may be dropped');
  assert.equal(harness.mergeConversationCalls.length, 1);
  assert.equal(harness.setTotalUnreadCalls.length, 1);
});

test('message routing sees conversations that are still in the flush buffer', () => {
  const harness = loadListenersHarness();
  harness.bindOpenIMListeners();
  harness.state.activeConversation = null;

  // 一个全新群会话刚被推送过来，还躺在 120ms 缓冲里没进 store。
  harness.handlers.get('onConversationChanged')([
    { conversationID: 'conv-new', groupID: 'group-new', showName: '新群' },
  ]);
  // 紧接着同一窗口内到达该群的第一条消息。
  harness.handlers.get('onRecvNewMessages')([
    { clientMsgID: 'm1', groupID: 'group-new', sessionType: 2, sendID: 'other' },
  ]);

  // buildChatSnackbar 对「查不到会话」的群消息返回 null（直接丢弃，不是降级），
  // 所以路由用的会话列表必须叠上缓冲内容 —— 否则新群的首条消息永远没有横幅。
  const seen = harness.snackbarConversationLists.at(-1) ?? [];
  assert.ok(
    seen.some((c) => c.conversationID === 'conv-new'),
    'snackbar routing must see buffered conversations',
  );
});

test('C2C read receipts route against buffered conversations too', () => {
  const harness = loadListenersHarness();
  harness.bindOpenIMListeners();

  harness.handlers.get('onConversationChanged')([
    { conversationID: 'conv-peer', userID: 'peer-1' },
  ]);
  // receipt 不带 conversationID，只能按 userID 反查；查不到就被永久丢弃。
  harness.handlers.get('onRecvC2CReadReceipt')([
    { userID: 'peer-1', msgIDList: ['m1'] },
  ]);

  assert.deepEqual(harness.markReadIdCalls, [['conv-peer', ['m1']]]);
});

test('unbind flushes conversations and unread, not just messages', () => {
  const harness = loadListenersHarness();
  const unbind = harness.bindOpenIMListeners();

  harness.handlers.get('onConversationChanged')([{ conversationID: 'conv-1' }]);
  harness.handlers.get('onTotalUnreadMessageCountChanged')(7);

  unbind();

  // 登出 teardown 时缓冲里的最后一批不能凭空消失 —— 消息路径本来就有这个保证，
  // 会话和未读加入同一个缓冲后必须一并保住。
  assert.equal(harness.timers[0].cleared, true);
  assert.equal(harness.mergeConversationCalls.length, 1);
  assert.deepEqual(harness.setTotalUnreadCalls, [7]);
  assert.deepEqual(harness.badgeUnreadCalls, [7]);
});

test('onKickedOffline is a terminal disconnect, not a token refresh (no relogin storm)', () => {
  const harness = loadListenersHarness();
  harness.bindOpenIMListeners();
  const handleKicked = harness.handlers.get('onKickedOffline');
  assert.equal(typeof handleKicked, 'function');

  handleKicked();

  // 同账号在另一端顶替登录把本端踢下线：进入断连终态 + 给用户可读解释，
  // 但绝不换 token 原地重登（否则会把新设备再踢下线，两端互踢成风暴）。
  assert.deepEqual(harness.setConnectedCalls, [false]);
  assert.equal(harness.setErrorCalls.length, 1);
  assert.equal(harness.recoverCalls.length, 0);
  // 且必须取消所有补登 / 恢复欠账，否则回前台又会重登、重演互踢风暴。
  assert.equal(harness.clearRetryCalls.length, 1);
  assert.equal(harness.cancelRecoveryCalls.length, 1);
});

test('onConnectSuccess ignores a late connect when the login was abandoned (currentUserID cleared)', async () => {
  const harness = loadListenersHarness();
  harness.bindOpenIMListeners();
  const handleConnected = harness.handlers.get('onConnectSuccess');

  // 登录因就绪超时 / 失败放弃后 currentUserID 被清为 null。此时迟到的连接成功事件绝不能把
  // connected 翻真——否则留下「已连接但身份为 null」的僵尸会话,读回执 / 消息归属会错到下次
  // 前台重登才纠正。
  harness.state.currentUserID = null;
  await handleConnected();

  assert.ok(
    !harness.setConnectedCalls.includes(true),
    'late connect with a null identity must not mark the session connected',
  );
});

test('onConnectSuccess marks connected for a normal connect that still has a live identity', async () => {
  const harness = loadListenersHarness();
  harness.bindOpenIMListeners();
  const handleConnected = harness.handlers.get('onConnectSuccess');

  // 正常登录 / 重连:currentUserID 在 login() 前就乐观写入,连接成功照常建立会话。
  harness.state.currentUserID = 'self';
  await handleConnected();

  assert.ok(
    harness.setConnectedCalls.includes(true),
    'a connect with a current identity must mark the session connected',
  );
});
