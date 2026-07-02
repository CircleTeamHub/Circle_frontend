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

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

test('circle card: type, send, and decode are wired through the IM layer', () => {
  const types = read('src/types/index.ts');
  assert.match(types, /interface CircleCardData/);
  assert.match(types, /'circle-card'/);
  assert.match(types, /circleCard\?: CircleCardData/);

  const client = read('src/im/client.ts');
  assert.match(client, /sendCircleCardMessage/);
  assert.match(client, /createCardMessage/);
  assert.match(client, /kind: 'circle'/);

  // mappers disambiguate circle vs friend card via ex.kind
  const mappers = read('src/im/mappers.ts');
  assert.match(mappers, /ext\.kind === 'circle'/);
  assert.match(mappers, /type: 'circle-card'/);
  assert.match(mappers, /circleId: card\.userID/);
});

test('circle card: bubble renders and taps through to the circle detail', () => {
  const bubble = read(
    'src/features/chat/components/bubbles/circle-card-bubble.tsx',
  );
  assert.match(bubble, /export const CircleCardBubble/);
  assert.match(bubble, /message\.circleCard/);
  // The bubble uses the sent snapshot. The detail screen owns live fetching,
  // which avoids an N+1 request pattern while scrolling chat history.
  assert.doesNotMatch(bubble, /fetchCircleDetail\(circleId\)/);
  assert.match(bubble, /displayName/);
  assert.match(bubble, /displayAvatar/);

  const chat = read('src/features/chat/screens/ChatDetailScreen.tsx');
  assert.match(chat, /case 'circle-card':/);
  assert.match(chat, /<CircleCardBubble/);
  // tapping opens the circle detail (where the join button lives)
  assert.match(
    chat,
    /router\.push\(`\/\(tabs\)\/discover\/circle\/\$\{encodeURIComponent\(card\.circleId\)\}`\)/,
  );
});

test('circle card bubble uses a compact card layout independent of friend cards', () => {
  const shared = read('src/features/chat/components/bubbles/shared.tsx');
  const bubble = read(
    'src/features/chat/components/bubbles/circle-card-bubble.tsx',
  );

  assert.match(shared, /const sCircleCard = StyleSheet\.create/);
  assert.match(shared, /card:\s*\{[\s\S]*width:\s*CHAT_CARD_STANDARD_WIDTH/);
  assert.match(
    shared,
    /card:\s*\{[\s\S]*paddingVertical:\s*CHAT_CARD_PADDING_VERTICAL/,
  );
  assert.match(bubble, /<CircleAvatar[\s\S]*size=\{48\}/);
  assert.match(shared, /sCircleCard\.card/);
  assert.doesNotMatch(shared, /const CHAT_CARD_WIDTH = 220/);
});

test('ShareCircleCardScreen sends the card to a chosen conversation', () => {
  const share = read(
    'src/features/discover/screens/ShareCircleCardScreen.tsx',
  );
  assert.match(share, /useTranslation/);
  assert.doesNotMatch(share, /Alert\.alert\(\s*'发送圈子名片'/);
  assert.match(share, /sendCircleCardMessage/);
  assert.match(share, /targetConversationID: conversation\.id/);
});

test('ShareCircleCardScreen does not leave a row stuck in sending state when SDK send hangs', () => {
  const share = read(
    'src/features/discover/screens/ShareCircleCardScreen.tsx',
  );

  assert.match(share, /SENDING_STATE_FALLBACK_MS/);
  assert.match(share, /sendingTimeoutRef/);
  assert.match(share, /setTimeout\(\(\) => \{/);
  assert.match(share, /const mountedRef = useRef\(true\)/);
  assert.match(share, /mountedRef\.current = false/);
  assert.match(share, /if \(mountedRef\.current\) setSendingConversationID\(''\)/);
  assert.match(share, /if \(!mountedRef\.current\) return;[\s\S]*setSendingConversationID\(''\)/);
  assert.match(share, /\.then\(\(\) => \{[\s\S]*if \(!mountedRef\.current\) return;[\s\S]*Alert\.alert/);
  assert.match(share, /\.catch\(\(error: unknown\) => \{[\s\S]*if \(!mountedRef\.current\) return;[\s\S]*Alert\.alert/);
  assert.match(share, /clearTimeout/);
});

test('circle card mapper recovers avatar from card extension when OpenIM faceURL is empty', () => {
  const { mapMessageItemToChatMessage } = loadTsModule('src/im/mappers.ts', {
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
      fromImUserId: (userID) => userID,
    },
    '@/services/api/utils': {
      normalizeMediaUrl: (url) => url,
    },
    '@/i18n': {
      __esModule: true,
      default: {
        language: 'zh',
        t: (_key, options) => options.defaultValue,
      },
    },
    '@/features/contacts/locale': {
      getLocalizedDateTimeLocale: (lng) =>
        lng && lng.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US',
    },
  });

  const mapped = mapMessageItemToChatMessage(
    {
      clientMsgID: 'circle-card-1',
      sendID: 'peer-1',
      senderNickname: 'Peer',
      contentType: 108,
      sendTime: new Date(2024, 0, 2, 12, 0, 0).getTime(),
      status: 2,
      isRead: false,
      cardElem: {
        userID: 'circle-1',
        nickname: '上海同城交友',
        faceURL: '',
        ex: JSON.stringify({
          v: 'circle-card-v1',
          kind: 'circle',
          avatarUrl: 'https://cdn.example.com/circle.png',
        }),
      },
    },
    'me',
  );

  assert.equal(
    normalize(mapped).circleCard.avatarUrl,
    'https://cdn.example.com/circle.png',
  );
});
