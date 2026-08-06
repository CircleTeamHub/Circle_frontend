const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const MESSAGE_TYPE = {
  CustomMessage: 110,
  TypingMessage: 113,
  FriendAdded: 1201,
};
const FRIEND_ADDED_NOTICE_EXTENSION = 'friend-added-notice-v1';

function loadMappers() {
  const filePath = path.join(process.cwd(), 'src/im/mappers.ts');
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const context = {
    module: { exports: {} },
    exports: {},
    require: (specifier) => {
      if (specifier === '@openim/rn-client-sdk') {
        return { MessageType: MESSAGE_TYPE, SessionType: { Group: 2 } };
      }
      if (specifier === '@/im/client') {
        return {
          NOTE_CARD_EXTENSION: 'note-card-v1',
          TRANSFER_CARD_EXTENSION: 'transfer-card-v1',
          VERIFICATION_CARD_EXTENSION: 'circle-verify-v1',
          FRIEND_ADDED_NOTICE_EXTENSION,
          fromImUserId: (id) => id,
        };
      }
      if (specifier === '@/services/api/utils') {
        return { normalizeMediaUrl: (url) => url };
      }
      if (specifier === '@/i18n') {
        return {
          __esModule: true,
          default: {
            language: 'en',
            t: (_key, options) => options.defaultValue,
          },
        };
      }
      if (specifier === '@/utils/locale') {
        return { getLocalizedDateTimeLocale: () => 'en-US' };
      }
      throw new Error(`Unexpected import: ${specifier}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('ChatMessage supports a system-notice variant', () => {
  const types = read('src/types/index.ts');
  assert.match(types, /'system-notice'/);
});


test('chat screen renders the system-notice pill', () => {
  const screen = read('src/features/chat/screens/ChatDetailScreen.tsx');
  assert.match(screen, /SystemNoticePill/);
  assert.match(screen, /case 'system-notice':/);
});

test('SystemNoticePill component exists and is exported from the barrel', () => {
  const pill = read('src/features/chat/components/bubbles/system-notice-pill.tsx');
  assert.match(pill, /SystemNoticePill/);
  const barrel = read('src/features/chat/components/chat-bubble.tsx');
  assert.match(barrel, /SystemNoticePill/);
});




test('chat screen wires mapped messages through friend-added dedupe', () => {
  const screen = read('src/features/chat/screens/ChatDetailScreen.tsx');
  assert.match(screen, /collapseDuplicateFriendAddedNotices\(mapped\)/);
});


test('friendAdded notification string exists in every locale', () => {
  for (const locale of ['zh', 'en', 'ja', 'es', 'ko']) {
    const json = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    const value = json?.im?.notification?.friendAdded;
    assert.equal(
      typeof value,
      'string',
      `${locale}.json is missing im.notification.friendAdded`,
    );
    assert.ok(value.length > 0, `${locale}.json friendAdded is empty`);
  }
});
