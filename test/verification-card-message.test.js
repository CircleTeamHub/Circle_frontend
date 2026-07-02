const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

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

const normalize = (value) => JSON.parse(JSON.stringify(value));

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
    getLocalizedDateTimeLocale: (lng) =>
      lng && lng.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US',
  },
};

test('verification card: type, send, and decode are wired through the IM layer', () => {
  const types = read('src/types/index.ts');
  assert.match(types, /interface VerificationCardData/);
  assert.match(types, /'verification-card'/);
  assert.match(types, /verificationCard\?: VerificationCardData/);

  const client = read('src/im/client.ts');
  assert.match(client, /VERIFICATION_CARD_EXTENSION = 'circle-verify-v1'/);
  assert.match(client, /sendVerificationCardMessage/);
  assert.match(client, /createCustomMessage/);

  const mappers = read('src/im/mappers.ts');
  assert.match(mappers, /VERIFICATION_CARD_EXTENSION/);
  assert.match(mappers, /type: 'verification-card'/);
  assert.match(mappers, /parseVerificationCardPayload/);
});

test('verification card: bubble renders and taps through to the verify screen', () => {
  const bubble = read(
    'src/features/chat/components/bubbles/verification-card-bubble.tsx',
  );
  assert.match(bubble, /export const VerificationCardBubble/);
  assert.match(bubble, /message\.verificationCard/);

  const chat = read('src/features/chat/screens/ChatDetailScreen.tsx');
  assert.match(chat, /case 'verification-card':/);
  assert.match(chat, /<VerificationCardBubble/);
  assert.match(chat, /pathname: '\/\(tabs\)\/discover\/verification\/\[id\]'/);
  assert.match(chat, /params: \{ id: card\.invitationId \}/);
});

test('adding a verifier also sends a verification card to that friend', () => {
  const screen = read('src/features/discover/screens/SelectVerifierScreen.tsx');
  assert.match(screen, /addVerifierToInvitation\(invitationId, friend\.id\)/);
  assert.match(screen, /sendVerificationCardMessage/);
  assert.match(screen, /applicantName: myNickname/);

  // The invitation detail forwards circleName so the card can display it.
  const detail = read(
    'src/features/discover/screens/InvitationVerificationScreen.tsx',
  );
  assert.match(detail, /circleName: invitation\.circleName/);
});

test('verification card mapper decodes a custom message into a tappable card', () => {
  const { mapMessageItemToChatMessage } = loadTsModule(
    'src/im/mappers.ts',
    MAPPER_STUBS,
  );

  const mapped = mapMessageItemToChatMessage(
    {
      clientMsgID: 'verify-1',
      sendID: 'applicant-1',
      senderNickname: 'meiguici',
      contentType: 110,
      sendTime: new Date(2024, 0, 2, 12, 0, 0).getTime(),
      status: 2,
      isRead: false,
      customElem: {
        extension: 'circle-verify-v1',
        data: JSON.stringify({
          invitationId: 'inv-9',
          circleName: '申请测试圈·成都',
          applicantName: 'meiguici',
        }),
      },
    },
    'me',
  );

  const n = normalize(mapped);
  assert.equal(n.type, 'verification-card');
  assert.equal(n.verificationCard.invitationId, 'inv-9');
  assert.equal(n.verificationCard.circleName, '申请测试圈·成都');
  assert.equal(n.verificationCard.applicantName, 'meiguici');
});

test('verification card mapper rejects a custom message missing invitationId', () => {
  const { mapMessageItemToChatMessage } = loadTsModule(
    'src/im/mappers.ts',
    MAPPER_STUBS,
  );

  const mapped = mapMessageItemToChatMessage(
    {
      clientMsgID: 'verify-bad',
      sendID: 'applicant-1',
      senderNickname: 'meiguici',
      contentType: 110,
      sendTime: new Date(2024, 0, 2, 12, 0, 0).getTime(),
      status: 2,
      isRead: false,
      customElem: {
        extension: 'circle-verify-v1',
        data: JSON.stringify({ circleName: 'x' }),
      },
    },
    'me',
  );

  // Falls through to a non-card type instead of a broken verification card.
  assert.notEqual(normalize(mapped).type, 'verification-card');
});

test('verification card mapper rejects an empty-string invitationId', () => {
  const { mapMessageItemToChatMessage } = loadTsModule(
    'src/im/mappers.ts',
    MAPPER_STUBS,
  );

  const mapped = mapMessageItemToChatMessage(
    {
      clientMsgID: 'verify-empty',
      sendID: 'applicant-1',
      senderNickname: 'meiguici',
      contentType: 110,
      sendTime: new Date(2024, 0, 2, 12, 0, 0).getTime(),
      status: 2,
      isRead: false,
      customElem: {
        extension: 'circle-verify-v1',
        // Empty id would otherwise route taps to /verification/ with no id.
        data: JSON.stringify({ invitationId: '', circleName: 'x' }),
      },
    },
    'me',
  );

  assert.notEqual(normalize(mapped).type, 'verification-card');
});
