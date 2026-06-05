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
    URLSearchParams,
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });

  return context.module.exports;
}

function loadChatHistoryApi(apiClient) {
  return loadTsModule('src/services/api/chat-history.ts', {
    '@openim/rn-client-sdk': {
      MessageType: {
        TextMessage: 101,
        PictureMessage: 102,
        VoiceMessage: 103,
        VideoMessage: 104,
        FileMessage: 105,
        AtTextMessage: 106,
        CardMessage: 108,
        LocationMessage: 109,
        CustomMessage: 110,
        QuoteMessage: 114,
        FaceMessage: 115,
      },
    },
    '@/services/api/client': { apiClient },
  });
}

test('chat history api fetches conversation message pages', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/services/api/chat-history.ts'),
    'utf8',
  );

  assert.match(source, /fetchRestorableConversationMessages/);
  assert.match(
    source,
    /\/chat-history\/conversations\/\$\{encodeURIComponent\(conversationID\)\}\/messages/,
  );
  assert.match(source, /beforeSeq/);
  assert.match(source, /toOpenIMMessageItem/);
});

test('chat history api normalizes response pages before exposing them to restore logic', async () => {
  const apiCalls = [];
  const { fetchRestorableConversationMessages } = loadChatHistoryApi(
    async (endpoint) => {
      apiCalls.push(endpoint);
      return {
        conversationID: 123,
        messages: [
          {
            clientMsgID: 456,
            contentType: '101',
            sessionType: '1',
            seq: '7',
            sendTime: '1007',
            createTime: '907',
            isRead: 1,
          },
          { content: 'missing-id' },
        ],
        hasMore: 'true',
        nextBeforeSeq: '6',
      };
    },
  );

  const page = await fetchRestorableConversationMessages({
    conversationID: 'si_a_b',
    limit: 500,
    beforeSeq: 10,
  });

  assert.equal(
    apiCalls[0],
    '/chat-history/conversations/si_a_b/messages?limit=200&beforeSeq=10',
  );
  assert.deepEqual(JSON.parse(JSON.stringify(page)), {
    conversationID: '123',
    messages: [
      {
        clientMsgID: '456',
        serverMsgID: '',
        sendID: '',
        recvID: '',
        groupID: '',
        senderNickname: '',
        senderFaceUrl: '',
        sessionType: 1,
        contentType: 101,
        status: 0,
        seq: 7,
        sendTime: 1007,
        createTime: 907,
        content: '',
        attachedInfo: '',
        ex: '',
        isRead: false,
      },
    ],
    hasMore: false,
    nextBeforeSeq: 6,
    serverMinSeq: null,
    serverMaxSeq: null,
  });
});

test('toOpenIMMessageItem rebuilds text elem from OpenIM content JSON', () => {
  const { toOpenIMMessageItem } = loadChatHistoryApi(async () => ({}));

  const message = toOpenIMMessageItem({
    clientMsgID: 'client-1',
    serverMsgID: 'server-1',
    sendID: 'sender',
    recvID: 'receiver',
    groupID: '',
    senderNickname: 'Sender',
    senderFaceUrl: '',
    sessionType: 1,
    contentType: 101,
    status: 2,
    seq: 1,
    sendTime: 1000,
    createTime: 900,
    content: JSON.stringify({ content: 'hello' }),
    attachedInfo: '{bad json',
    ex: '',
    isRead: true,
  });

  assert.equal(message.textElem.content, 'hello');
  assert.deepEqual(JSON.parse(JSON.stringify(message.attachedInfoElem)), {});
});
