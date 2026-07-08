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
      paths: { '@/*': ['src/*'] },
    },
    fileName: filePath,
  }).outputText;

  const context = {
    module: { exports: {} },
    exports: {},
    require: (specifier) =>
      specifier in stubs ? stubs[specifier] : require(specifier),
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

const MAPPER_STUBS = {
  '@openim/rn-client-sdk': {
    MessageType: {
      TextMessage: 101,
      PictureMessage: 102,
      VoiceMessage: 103,
      VideoMessage: 104,
      FileMessage: 105,
      CardMessage: 108,
      LocationMessage: 109,
      CustomMessage: 110,
      TypingMessage: 113,
    },
    SessionType: { Single: 1, Group: 2 },
  },
  '@/im/client': {
    NOTE_CARD_EXTENSION: 'note-card-v1',
    TRANSFER_CARD_EXTENSION: 'transfer-card-v1',
    VERIFICATION_CARD_EXTENSION: 'circle-verify-v1',
    fromImUserId: (userID) => userID,
  },
  '@/services/api/utils': { normalizeMediaUrl: (url) => url },
  '@/i18n': {
    __esModule: true,
    default: { language: 'zh', t: (_key, options) => options.defaultValue },
  },
  '@/utils/locale': {
    getLocalizedDateTimeLocale: () => 'zh-CN',
  },
};

test('message mapper cache remaps an optimistic message after SDK mutates its status', () => {
  const {
    createMessageMapCache,
    mapMessageItemsToChatMessages,
  } = loadTsModule('src/im/mappers.ts', MAPPER_STUBS);
  const cache = createMessageMapCache('self');
  const message = {
    clientMsgID: 'msg-1',
    sendID: 'self',
    recvID: 'peer',
    sessionType: 1,
    contentType: 101,
    sendTime: Date.now(),
    status: 1,
    isRead: false,
    textElem: { content: 'hello' },
    content: 'hello',
  };

  let mapped = mapMessageItemsToChatMessages([message], 'self', cache);
  assert.equal(mapped[0].sendStatus, 1);

  message.status = 2;
  mapped = mapMessageItemsToChatMessages([message], 'self', cache);
  assert.equal(mapped[0].sendStatus, 2);
});
