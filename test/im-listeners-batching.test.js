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
    mergeConversations: () => {},
    setTotalUnread: () => {},
    markMessagesRead: () => {},
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
        return { buildChatSnackbar: () => null };
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
            getState: () => ({ setMessagesUnread: () => {} }),
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
