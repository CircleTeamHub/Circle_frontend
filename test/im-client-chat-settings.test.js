const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// 默认兜底：client.ts 顶层会 import @/im/listeners + @/services/auth/session，
// 测试不关心其副作用，no-op stub 即可。call site 可通过 stubs 覆盖。
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
        deleteConversationAndDeleteAllMsg: async (conversationID) => {
          sdkCalls.push(['deleteConversationAndDeleteAllMsg', conversationID]);
        },
        deleteAllMsgFromLocal: async () => {
          sdkCalls.push(['deleteAllMsgFromLocal']);
        },
        getConversationListSplit: async (params) => {
          sdkCalls.push(['getConversationListSplit', params]);
          return [];
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
          setConversations: (...args) => {
            storeCalls.push(['setConversations', ...args]);
          },
          mergeConversations: () => undefined,
          clearAllMessages: () => {
            storeCalls.push(['clearAllMessages']);
          },
          setMessages: (...args) => {
            storeCalls.push(['setMessages', ...args]);
          },
        }),
      },
    },
    '@/stores/tabBadgeStore': {
      useTabBadgeStore: {
        getState: () => ({
          setMessagesUnread: (count) => {
            storeCalls.push(['setMessagesUnread', count]);
          },
        }),
      },
    },
  });
}

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadSearchClient(sdkCalls, searchResult = { totalCount: 0, searchResultItems: [] }) {
  return loadTsModule('src/im/client.ts', {
    '@openim/rn-client-sdk': {
      __esModule: true,
      default: {
        initSDK: async () => undefined,
        searchLocalMessages: async (params) => {
          sdkCalls.push(['searchLocalMessages', params]);
          return searchResult;
        },
      },
      LogLevel: { Info: 0 },
      SessionType: { Single: 1, Group: 2 },
      ViewType: { History: 0 },
      MessageType: {
        TextMessage: 101,
        PictureMessage: 102,
        VoiceMessage: 103,
        VideoMessage: 104,
        FileMessage: 105,
        CardMessage: 108,
        LocationMessage: 109,
        CustomMessage: 110,
      },
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
          setMessages: () => undefined,
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

  assert.deepEqual(normalize(sdkCalls), [
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

  assert.deepEqual(normalize(sdkCalls), [
    ['clearConversationAndDeleteAllMsg', 'conversation-99'],
  ]);
  assert.deepEqual(normalize(storeCalls), [
    ['setMessages', 'conversation-99', []],
  ]);
});

test('deleteConversation deletes the OpenIM conversation and refreshes the list', async () => {
  const sdkCalls = [];
  const storeCalls = [];
  const { deleteConversation } = loadChatSettingsClient(sdkCalls, storeCalls);

  await deleteConversation('conversation-99');

  assert.deepEqual(normalize(sdkCalls), [
    ['deleteConversationAndDeleteAllMsg', 'conversation-99'],
    ['getConversationListSplit', { offset: 0, count: 100 }],
  ]);
  assert.deepEqual(normalize(storeCalls), [
    ['setMessages', 'conversation-99', []],
    ['setConversations', []],
  ]);
});

test('clearAllLocalMessages clears only local OpenIM messages and refreshes local state', async () => {
  const sdkCalls = [];
  const storeCalls = [];
  const { clearAllLocalMessages } = loadChatSettingsClient(sdkCalls, storeCalls);

  await clearAllLocalMessages();

  assert.deepEqual(normalize(sdkCalls), [
    ['deleteAllMsgFromLocal'],
    ['getConversationListSplit', { offset: 0, count: 100 }],
  ]);
  assert.deepEqual(normalize(storeCalls), [
    ['clearAllMessages'],
    ['setMessagesUnread', 0],
    ['setConversations', []],
  ]);
});

test('sendFriendCardMessage creates and sends a friend card message to the target conversation', async () => {
  const sdkCalls = [];
  const { sendFriendCardMessage } = loadTsModule('src/im/client.ts', {
    '@openim/rn-client-sdk': {
      __esModule: true,
      default: {
        initSDK: async () => undefined,
        createCardMessage: async (params) => {
          sdkCalls.push(['createCardMessage', params]);
          return { clientMsgID: 'message-1' };
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
          conversations: [
            {
              conversationID: 'conversation-2',
              userID: 'target-user',
              groupID: '',
            },
          ],
          setError: () => undefined,
          setInitialized: () => undefined,
          setCurrentUserID: () => undefined,
          setConnecting: () => undefined,
          reset: () => undefined,
          setConversations: () => undefined,
          mergeConversations: () => undefined,
          setMessages: () => undefined,
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

  await sendFriendCardMessage({
    targetConversationID: 'conversation-2',
    userID: 'friend-1',
    nickname: '小李',
    faceURL: '',
  });

  // client.ts 把业务扩展塞进 cardElem.ex（persona + displayIcons），即便调用方
  // 没传，也会序列化成默认 `friend-card-v1` 信封 —— 见 FriendCardExt。
  assert.deepEqual(normalize(sdkCalls), [
    [
      'createCardMessage',
      {
        userID: 'friend-1',
        nickname: '小李',
        faceURL: '',
        ex: JSON.stringify({
          v: 'friend-card-v1',
          persona: null,
          displayIcons: [],
        }),
      },
    ],
    [
      'sendMessage',
      {
        recvID: 'target-user',
        groupID: '',
        message: { clientMsgID: 'message-1' },
        offlinePushInfo: {
          title: '好友推荐',
          desc: '小李',
          ex: '',
          iOSPushSound: 'default',
          iOSBadgeCount: true,
        },
      },
    ],
  ]);
});

test('sendCircleCardMessage stores the circle avatar in card extension as a fallback snapshot', async () => {
  const sdkCalls = [];
  const { sendCircleCardMessage } = loadTsModule('src/im/client.ts', {
    '@openim/rn-client-sdk': {
      __esModule: true,
      default: {
        initSDK: async () => undefined,
        createCardMessage: async (params) => {
          sdkCalls.push(['createCardMessage', params]);
          return { clientMsgID: 'message-1' };
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
          conversations: [
            {
              conversationID: 'conversation-2',
              userID: 'target-user',
              groupID: '',
              conversationType: 1,
            },
          ],
          setError: () => undefined,
          setInitialized: () => undefined,
          setCurrentUserID: () => undefined,
          setConnecting: () => undefined,
          reset: () => undefined,
          setConversations: () => undefined,
          mergeConversations: () => undefined,
          setMessages: () => undefined,
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

  await sendCircleCardMessage({
    targetConversationID: 'conversation-2',
    circleId: 'circle-1',
    name: '上海同城交友',
    avatarUrl: 'https://cdn.example.com/circle.png',
  });

  assert.deepEqual(normalize(sdkCalls), [
    [
      'createCardMessage',
      {
        userID: 'circle-1',
        nickname: '上海同城交友',
        faceURL: 'https://cdn.example.com/circle.png',
        ex: JSON.stringify({
          v: 'circle-card-v1',
          kind: 'circle',
          avatarUrl: 'https://cdn.example.com/circle.png',
        }),
      },
    ],
    [
      'sendMessage',
      {
        recvID: 'target-user',
        groupID: '',
        message: { clientMsgID: 'message-1' },
        offlinePushInfo: {
          title: '圈子邀请',
          desc: '上海同城交友',
          ex: '',
          iOSPushSound: 'default',
          iOSBadgeCount: true,
        },
      },
    ],
  ]);
});

test('searchConversationTextMessages searches the current conversation by keyword', async () => {
  const sdkCalls = [];
  const { searchConversationTextMessages } = loadSearchClient(sdkCalls);

  await searchConversationTextMessages({
    conversationID: 'conversation-1',
    keyword: 'hello',
  });

  assert.deepEqual(normalize(sdkCalls), [
    [
      'searchLocalMessages',
      {
        conversationID: 'conversation-1',
        keywordList: ['hello'],
        keywordListMatchType: 0,
        messageTypeList: [101],
        pageIndex: 1,
        count: 20,
      },
    ],
  ]);
});

test('searchConversationMediaMessages filters image and video messages', async () => {
  const sdkCalls = [];
  const { searchConversationMediaMessages } = loadSearchClient(sdkCalls);

  await searchConversationMediaMessages({
    conversationID: 'conversation-1',
    pageIndex: 2,
    count: 10,
  });

  assert.deepEqual(normalize(sdkCalls), [
    [
      'searchLocalMessages',
      {
        conversationID: 'conversation-1',
        keywordList: [''],
        messageTypeList: [102, 104],
        pageIndex: 2,
        count: 10,
      },
    ],
  ]);
});

test('searchConversationFileMessages filters file messages', async () => {
  const sdkCalls = [];
  const { searchConversationFileMessages } = loadSearchClient(sdkCalls);

  await searchConversationFileMessages({
    conversationID: 'conversation-1',
  });

  assert.deepEqual(normalize(sdkCalls), [
    [
      'searchLocalMessages',
      {
        conversationID: 'conversation-1',
        keywordList: [''],
        messageTypeList: [105],
        pageIndex: 1,
        count: 20,
      },
    ],
  ]);
});

test('searchConversationMessagesByDate constrains the time window to the selected day', async () => {
  const sdkCalls = [];
  const { searchConversationMessagesByDate } = loadSearchClient(sdkCalls);

  await searchConversationMessagesByDate({
    conversationID: 'conversation-1',
    date: '2026-04-16',
  });

  assert.deepEqual(normalize(sdkCalls), [
    [
      'searchLocalMessages',
      {
        conversationID: 'conversation-1',
        keywordList: [''],
        messageTypeList: [101, 102, 103, 104, 105, 109, 108, 110],
        searchTimePosition: new Date('2026-04-16T00:00:00').getTime(),
        searchTimePeriod: 24 * 60 * 60,
        pageIndex: 1,
        count: 50,
      },
    ],
  ]);
});
