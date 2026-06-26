const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// client.ts 顶层会 import @/im/listeners 和 @/services/auth/session 用于事件绑定 / teardown
// 注册；测试里我们不关心它们的副作用，全部 no-op 兜底即可。call-site 仍可通过 stubs 覆盖。
const DEFAULT_TS_MODULE_STUBS = {
  '@/im/listeners': {
    bindOpenIMListeners: () => () => {},
  },
  '@/services/auth/session': {
    registerLogoutHandler: () => () => {},
  },
};

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

  const mergedStubs = { ...DEFAULT_TS_MODULE_STUBS, ...stubs };
  const context = {
    module: { exports: {} },
    exports: {},
    setTimeout,
    clearTimeout,
    require: (specifier) => {
      if (specifier in mergedStubs) {
        return mergedStubs[specifier];
      }

      return require(specifier);
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });

  return context.module.exports;
}

// client.ts 顶层现在还会 import @/im/media-uri（本地路径 scheme 处理）；注入真实实现以便 require 解析。
DEFAULT_TS_MODULE_STUBS['@/im/media-uri'] = loadTsModule('src/im/media-uri.ts');
DEFAULT_TS_MODULE_STUBS['@/im/user-id'] = loadTsModule('src/im/user-id.ts');
DEFAULT_TS_MODULE_STUBS['@/observability/sentry'] = { reportError: () => {} };
DEFAULT_TS_MODULE_STUBS['@/features/chat/utils/voice-forward'] = loadTsModule(
  'src/features/chat/utils/voice-forward.ts',
);

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
    '@/stores/tabBadgeStore': {
      useTabBadgeStore: {
        getState: () => ({
          setMessagesUnread: () => undefined,
        }),
      },
    },
  });

  const result = await getOrCreateSingleConversation('user-2');

  assert.equal(result.conversationID, 'conversation-1');
  // client.ts 在 SDK 边界跨过去之前会调 toImUserId 去掉 dash（OpenIM v3.8 拒绝
  // 带连字符的 userID）。测试断言要反映这个真实行为。
  assert.deepEqual(
    JSON.parse(JSON.stringify(getOneConversationCalls[0])),
    { sourceID: 'user2', sessionType: 1 },
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
    '@/stores/tabBadgeStore': {
      useTabBadgeStore: {
        getState: () => ({
          setMessagesUnread: () => undefined,
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

test('sendTextMessage waits until IM connection is ready before sending', async () => {
  const sdkCalls = [];
  const storeState = {
    connected: false,
  };

  const { sendTextMessage } = loadTsModule('src/im/client.ts', {
    '@openim/rn-client-sdk': {
      __esModule: true,
      default: {
        initSDK: async () => undefined,
        createTextMessage: async (text) => {
          sdkCalls.push(['createTextMessage', text]);
          return { clientMsgID: 'client-1', textElem: { content: text } };
        },
        sendMessage: async (params) => {
          if (!storeState.connected) {
            throw new Error('IM connection is not ready');
          }
          sdkCalls.push(['sendMessage', params]);
          return { clientMsgID: 'client-1' };
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
    '@/stores/tabBadgeStore': {
      useTabBadgeStore: {
        getState: () => ({
          setMessagesUnread: () => undefined,
        }),
      },
    },
  });

  setTimeout(() => {
    storeState.connected = true;
  }, 10);

  const result = await sendTextMessage({
    sourceID: 'group-1',
    sessionType: 2,
    text: 'hello',
  });

  assert.equal(result.clientMsgID, 'client-1');
  assert.deepEqual(sdkCalls[0], ['createTextMessage', 'hello']);
  assert.equal(sdkCalls[1][0], 'sendMessage');
  assert.equal(sdkCalls[1][1].groupID, 'group-1');
  assert.equal(sdkCalls[1][1].recvID, '');
});

test('forwardMessage uses the native createForwardMessage primitive (preserves media)', async () => {
  const sdkCalls = [];
  const originalImage = {
    clientMsgID: 'img-1',
    contentType: 102,
    pictureElem: { bigPicture: { url: 'https://cdn.example.com/p.jpg' } },
  };

  const { forwardMessage } = loadTsModule('src/im/client.ts', {
    '@openim/rn-client-sdk': {
      __esModule: true,
      default: {
        initSDK: async () => undefined,
        createForwardMessage: async (message) => {
          sdkCalls.push(['createForwardMessage', message]);
          return { ...message, clientMsgID: 'forward-1' };
        },
        sendMessage: async (params) => {
          sdkCalls.push(['sendMessage', params]);
          return params.message;
        },
      },
      LogLevel: { Info: 0 },
      SessionType: { Single: 1, Group: 2 },
      ViewType: { History: 0 },
    },
    'react-native-fs': {
      __esModule: true,
      default: { DocumentDirectoryPath: '/tmp', mkdir: async () => undefined },
    },
    'react-native': { Platform: { OS: 'ios' } },
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
        }),
      },
    },
    '@/stores/tabBadgeStore': {
      useTabBadgeStore: { getState: () => ({ setMessagesUnread: () => undefined }) },
    },
  });

  const sent = await forwardMessage({
    sourceID: 'user-9',
    sessionType: 1,
    message: originalImage,
  });

  // The original image item is handed to the SDK forward primitive untouched,
  // so the picture is preserved without re-upload.
  assert.deepEqual(sdkCalls[0], ['createForwardMessage', originalImage]);
  assert.equal(sdkCalls[1][0], 'sendMessage');
  assert.equal(sdkCalls[1][1].recvID, 'user9');
  assert.equal(sdkCalls[1][1].groupID, '');
  assert.equal(sent.clientMsgID, 'forward-1');
});
