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

function message(clientMsgID, seq, overrides = {}) {
  return {
    clientMsgID,
    serverMsgID: `server-${seq}`,
    sendID: 'sender-1',
    recvID: 'peer-1',
    groupID: '',
    sessionType: 1,
    contentType: 101,
    seq,
    sendTime: 1000 + seq,
    createTime: 900 + seq,
    content: JSON.stringify({ content: `message ${seq}` }),
    isRead: false,
    ...overrides,
  };
}

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadRestoreHarness(options) {
  const sdkCalls = [];
  const clientCalls = [];
  const apiCalls = [];
  const pages = [...options.pages];
  const existingIDs = new Set(options.existingIDs ?? []);

  const module = loadTsModule('src/im/history-restore.ts', {
    '@openim/rn-client-sdk': {
      __esModule: true,
      default: {
        findMessageList: async (params) => {
          sdkCalls.push(['findMessageList', params]);
          const ids = params.flatMap((item) => item.clientMsgIDList);
          return ids.filter((id) => existingIDs.has(id)).map((id) => ({ clientMsgID: id }));
        },
        insertSingleMessageToLocalStorage: async (params) => {
          sdkCalls.push(['insertSingleMessageToLocalStorage', params]);
        },
        insertGroupMessageToLocalStorage: async (params) => {
          sdkCalls.push(['insertGroupMessageToLocalStorage', params]);
        },
      },
      SessionType: { Single: 1, Group: 3 },
    },
    '@/im/client': {
      readLocalConversationMessages: async (...args) => {
        clientCalls.push(['readLocalConversationMessages', ...args]);
        return options.localMessages ?? [];
      },
      loadConversationMessages: async (...args) => {
        clientCalls.push(['loadConversationMessages', ...args]);
        return [];
      },
    },
    '@/services/api/chat-history': {
      fetchRestorableConversationMessages: async (params) => {
        apiCalls.push(['fetchRestorableConversationMessages', params]);
        return pages.shift() ?? {
          conversationID: params.conversationID,
          messages: [],
          hasMore: false,
          nextBeforeSeq: null,
          serverMinSeq: null,
          serverMaxSeq: null,
        };
      },
      toOpenIMMessageItem: (dto) => dto,
    },
    '@/stores/imStore': {
      useIMStore: {
        getState: () => ({ currentUserID: options.currentUserID ?? 'me-1' }),
      },
    },
  });

  return { ...module, sdkCalls, clientCalls, apiCalls };
}

test('restoreConversationMessages inserts missing single messages into OpenIM local storage', async () => {
  const { restoreConversationMessages, sdkCalls, clientCalls } = loadRestoreHarness({
    localMessages: [message('client-15', 15)],
    pages: [
      {
        conversationID: 'si_me_peer',
        messages: [message('client-1', 1), message('client-2', 2)],
        hasMore: false,
        nextBeforeSeq: null,
      },
    ],
  });

  const result = await restoreConversationMessages({
    conversationID: 'si_me_peer',
    sourceID: 'peer-1',
    sessionType: 1,
  });

  assert.deepEqual(normalize(result), { fetched: 2, inserted: 2 });
  assert.equal(
    sdkCalls.filter(([name]) => name === 'insertSingleMessageToLocalStorage')
      .length,
    2,
  );
  assert.deepEqual(clientCalls.at(-1), ['loadConversationMessages', 'si_me_peer']);
});

test('restoreConversationMessages skips messages already present locally', async () => {
  const { restoreConversationMessages, sdkCalls } = loadRestoreHarness({
    localMessages: [],
    existingIDs: ['client-1'],
    pages: [
      {
        conversationID: 'si_me_peer',
        messages: [message('client-1', 1), message('client-2', 2)],
        hasMore: false,
        nextBeforeSeq: null,
      },
    ],
  });

  const result = await restoreConversationMessages({
    conversationID: 'si_me_peer',
    sourceID: 'peer-1',
    sessionType: 1,
  });

  assert.deepEqual(normalize(result), { fetched: 2, inserted: 1 });
  assert.deepEqual(
    sdkCalls
      .filter(([name]) => name === 'insertSingleMessageToLocalStorage')
      .map(([, params]) => params.message.clientMsgID),
    ['client-2'],
  );
});

test('restoreConversationMessages inserts group messages through group local storage api', async () => {
  const { restoreConversationMessages, sdkCalls } = loadRestoreHarness({
    localMessages: [],
    pages: [
      {
        conversationID: 'sg_123',
        messages: [
          message('client-1', 1, {
            groupID: '123',
            sessionType: 3,
          }),
        ],
        hasMore: false,
        nextBeforeSeq: null,
      },
    ],
  });

  const result = await restoreConversationMessages({
    conversationID: 'sg_123',
    sourceID: '123',
    sessionType: 3,
  });

  assert.deepEqual(normalize(result), { fetched: 1, inserted: 1 });
  assert.equal(
    sdkCalls.filter(([name]) => name === 'insertGroupMessageToLocalStorage')
      .length,
    1,
  );
});
