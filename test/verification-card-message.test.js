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


test('verification card: bubble renders and taps through to the verify screen', () => {
  const bubble = read(
    'src/features/chat/components/bubbles/verification-card-bubble.tsx',
  );
  assert.match(bubble, /export const VerificationCardBubble/);
  assert.match(bubble, /message\.verificationCard/);

  const chat = read('src/features/chat/screens/ChatDetailScreen.tsx');
  assert.match(chat, /case 'verification-card':/);
  assert.match(chat, /<VerificationCardBubble/);
  assert.match(chat, /getVerificationDetailHref\([\s\S]*card\.invitationId/);
});

test('adding a verifier does not send the card from the client', () => {
  // verification-card 断言的是「这个人被邀请当验证人」这个服务端事实,客户端能发
  // 就等于能凭空捏造它 —— 后端把它收进 SERVER_MESSAGE_TYPES,这次发送 100% 被
  // validateSendPayload 拒,还被 best-effort 的 catch 吞掉:卡片从来没送达过。
  // 现在由 CircleInvitationService.addVerifier 提交后服务端签发。
  const screen = read('src/features/discover/screens/SelectVerifierScreen.tsx');
  assert.match(screen, /addVerifierToInvitation\(invitationId, friend\.id\)/);
  assert.doesNotMatch(screen, /sendCardMessage/);
  assert.doesNotMatch(screen, /ensureDirectConversation/);
  assert.doesNotMatch(screen, /applicantName/);

  // The invitation detail forwards circleName so the card can display it.
  const detail = read(
    'src/features/discover/screens/InvitationVerificationScreen.tsx',
  );
  assert.match(detail, /circleName: invitation\.circleName/);
});



