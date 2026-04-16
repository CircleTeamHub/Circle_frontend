const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadTsModule(relativePath, stubs = {}) {
  const filePath = path.join(process.cwd(), relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      baseUrl: process.cwd(),
      paths: {
        '@/*': ['src/*'],
      },
    },
    fileName: filePath,
  }).outputText;

  const context = {
    module: { exports: {} },
    exports: {},
    require: (specifier) => {
      if (specifier in stubs) {
        return stubs[specifier];
      }

      return require(specifier);
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });

  return context.module.exports;
}

function loadChatSettingsClient(sdkCalls, storeCalls) {
  return loadTsModule('src/im/client.ts', {
    '@openim/rn-client-sdk': {
      __esModule: true,
      default: {
        initSDK: async () => undefined,
        pinConversation: async (params) => {
          sdkCalls.push(['pinConversation', params]);
        },
        setConversationRecvMessageOpt: async (params) => {
          sdkCalls.push(['setConversationRecvMessageOpt', params]);
        },
        setConversationBurnDuration: async (params) => {
          sdkCalls.push(['setConversationBurnDuration', params]);
        },
        clearConversationAndDeleteAllMsg: async (conversationID) => {
          sdkCalls.push(['clearConversationAndDeleteAllMsg', conversationID]);
        },
      },
      LogLevel: { Info: 0 },
      SessionType: { Single: 1, Group: 2 },
      ViewType: { History: 0 },
    },
    'react-native-fs': {
      __esModule: true,
      default: {
        DocumentDirectoryPath: '/tmp',
        mkdir: async () => undefined,
      },
    },
    'react-native': {
      Platform: { OS: 'ios' },
    },
    '@/constants/config': {
      OPENIM_API_URL: 'https://im.example.com',
      OPENIM_WS_URL: 'wss://im.example.com',
      OPENIM_LOG_LEVEL: 0,
    },
    '@/stores/imStore': {
      useIMStore: {
        getState: () => ({
          connected: true,
          setError: () => undefined,
          setInitialized: () => undefined,
          setCurrentUserID: () => undefined,
          setConnecting: () => undefined,
          reset: () => undefined,
          setConversations: () => undefined,
          mergeConversations: () => undefined,
          setMessages: (...args) => {
            storeCalls.push(['setMessages', ...args]);
          },
        }),
      },
    },
  });
}

test('im client chat setting wrappers call the expected OpenIM SDK methods', async () => {
  const sdkCalls = [];
  const storeCalls = [];
  const {
    toggleConversationPinned,
    setConversationMute,
    setConversationBurnDuration,
  } = loadChatSettingsClient(sdkCalls, storeCalls);

  await toggleConversationPinned('conversation-1', true);
  await setConversationMute('conversation-1', true);
  await setConversationBurnDuration('conversation-1', 60);

  assert.deepEqual(sdkCalls, [
    ['pinConversation', { conversationID: 'conversation-1', isPinned: true }],
    [
      'setConversationRecvMessageOpt',
      { conversationID: 'conversation-1', opt: 2 },
    ],
    ['setConversationBurnDuration', { conversationID: 'conversation-1', burnDuration: 60 }],
  ]);
  assert.deepEqual(storeCalls, []);
});

test('clearConversationMessages clears OpenIM history and local message cache', async () => {
  const sdkCalls = [];
  const storeCalls = [];
  const { clearConversationMessages } = loadChatSettingsClient(sdkCalls, storeCalls);

  await clearConversationMessages('conversation-99');

  assert.deepEqual(sdkCalls, [
    ['clearConversationAndDeleteAllMsg', 'conversation-99'],
  ]);
  assert.deepEqual(storeCalls, [
    ['setMessages', 'conversation-99', []],
  ]);
});
