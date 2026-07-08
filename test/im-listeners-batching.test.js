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
    setConnected: () => {},
    setError: () => {},
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
    offCalls,
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
});
