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
    setTimeout,
    clearTimeout,
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

test('getOrCreateSingleConversation fetches a private conversation and merges it into store', async () => {
  const mergeCalls = [];
  const getOneConversationCalls = [];
  const storeState = {
    connected: true,
  };
  const conversation = {
    conversationID: 'conversation-1',
    conversationType: 1,
    userID: 'user-2',
    groupID: '',
    showName: 'Jimmy',
    faceURL: '',
    recvMsgOpt: 0,
    unreadCount: 0,
    groupAtType: 0,
    latestMsg: '',
    latestMsgSendTime: 0,
    draftText: '',
    draftTextTime: 0,
    burnDuration: 0,
    msgDestructTime: 0,
    isPinned: false,
    isNotInGroup: false,
    isPrivateChat: false,
    isMsgDestruct: false,
    attachedInfo: '',
  };

  const { getOrCreateSingleConversation } = loadTsModule('src/im/client.ts', {
    '@openim/rn-client-sdk': {
      __esModule: true,
      default: {
        initSDK: async () => undefined,
        getOneConversation: async (params) => {
          getOneConversationCalls.push(params);
          return conversation;
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
          connected: storeState.connected,
          setError: () => undefined,
          setInitialized: () => undefined,
          setCurrentUserID: () => undefined,
          setConnecting: () => undefined,
          reset: () => undefined,
          setConversations: () => undefined,
          mergeConversations: (items) => mergeCalls.push(items),
        }),
      },
    },
  });

  const result = await getOrCreateSingleConversation('user-2');

  assert.equal(result.conversationID, 'conversation-1');
  assert.deepEqual(
    JSON.parse(JSON.stringify(getOneConversationCalls[0])),
    { sourceID: 'user-2', sessionType: 1 },
  );
  assert.equal(mergeCalls.length, 1);
  assert.equal(mergeCalls[0][0].conversationID, 'conversation-1');
});

test('getOrCreateSingleConversation waits until IM connection is ready before reading conversation resources', async () => {
  const getOneConversationCalls = [];
  const storeState = {
    connected: false,
  };

  const { getOrCreateSingleConversation } = loadTsModule('src/im/client.ts', {
    '@openim/rn-client-sdk': {
      __esModule: true,
      default: {
        initSDK: async () => undefined,
        getOneConversation: async (params) => {
          if (!storeState.connected) {
            throw new Error('Resource initialization incomplete');
          }
          getOneConversationCalls.push(params);
          return {
            conversationID: 'conversation-2',
            conversationType: 1,
            userID: 'user-3',
            groupID: '',
            showName: 'Tom',
            faceURL: '',
            recvMsgOpt: 0,
            unreadCount: 0,
            groupAtType: 0,
            latestMsg: '',
            latestMsgSendTime: 0,
            draftText: '',
            draftTextTime: 0,
            burnDuration: 0,
            msgDestructTime: 0,
            isPinned: false,
            isNotInGroup: false,
            isPrivateChat: false,
            isMsgDestruct: false,
            attachedInfo: '',
          };
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
          connected: storeState.connected,
          setError: () => undefined,
          setInitialized: () => undefined,
          setCurrentUserID: () => undefined,
          setConnecting: () => undefined,
          reset: () => undefined,
          setConversations: () => undefined,
          mergeConversations: () => undefined,
        }),
      },
    },
  });

  setTimeout(() => {
    storeState.connected = true;
  }, 10);

  const result = await getOrCreateSingleConversation('user-3');

  assert.equal(result.conversationID, 'conversation-2');
  assert.equal(getOneConversationCalls.length, 1);
});
