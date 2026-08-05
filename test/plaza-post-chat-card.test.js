/* global __dirname */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(__dirname, '..', rel));

function loadPlazaCardParser() {
  const filePath = path.join(__dirname, '..', 'src/im/mappers.ts');
  const source = fs.readFileSync(filePath, 'utf8').replace(
    'function parsePlazaPostCardPayload',
    'export function parsePlazaPostCardData',
  );
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText;
  const context = {
    module: { exports: {} },
    exports: {},
    console,
    require: (specifier) => {
      if (specifier === '@openim/rn-client-sdk') return { MessageType: {}, SessionType: {} };
      if (specifier === '@/services/api/utils')
        return {
          normalizeMediaUrl: (value) => value,
          allowPeerMediaUrl: (value) => value ?? null,
        };
      if (specifier === '@/i18n') return { __esModule: true, default: { t: (_key, options) => options.defaultValue, language: 'en' } };
      if (specifier === '@/utils/locale') return { getLocalizedDateTimeLocale: () => 'en' };
      return {};
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports.parsePlazaPostCardData;
}

test('plaza-post card message: extension + send into current conversation', () => {
  const client = read('src/im/client.ts');
  assert.match(client, /PLAZA_POST_CARD_EXTENSION = 'plaza-post-card-v1'/);
  // 只保留「发进当前会话」一条路径（报名→聊天待发卡片用）。
  assert.match(client, /export async function sendPlazaPostCardMessage/);
  // 通用「发到选中会话」的分享路径已撤掉。
  assert.doesNotMatch(client, /sendPlazaPostCardToConversation/);
});

test('mappers parse + preview + map the plaza-post card', () => {
  const mappers = read('src/im/mappers.ts');
  assert.match(mappers, /function parsePlazaPostCardData/);
  assert.match(mappers, /ext === PLAZA_POST_CARD_EXTENSION/);
  assert.match(mappers, /type: 'plaza-post-card'/);
  // 卡片封面必须走来源白名单，而不是直通的 normalizeMediaUrl：payload 由对端完全
  // 控制，指向任意主机时每个看到这条消息的人都会静默 GET 一次，等于把 IP 和已读
  // 时刻送出去。
  assert.match(mappers, /coverUrl: allowPeerMediaUrl\(payload\.coverUrl\)/);
});

test('plaza-post card parser rejects malformed identifiers and titles', () => {
  const parseCard = loadPlazaCardParser();
  const encode = (value) => JSON.stringify({
    ...value,
    contentPreview: null,
    coverUrl: null,
    circleName: '',
    city: null,
    signupCount: 0,
    authorNickname: '',
  });

  assert.equal(parseCard(encode({ postId: '', title: 'x' })), null);
  assert.equal(parseCard(encode({ postId: '   ', title: 'x' })), null);
  assert.equal(parseCard(encode({ postId: 'post-1', title: '   ' })), null);
  assert.equal(parseCard(encode({ postId: 'x'.repeat(257), title: 'x' })), null);
  assert.equal(parseCard(encode({ postId: 'post-1', title: 'x'.repeat(201) })), null);
  const valid = parseCard(encode({ postId: '  post-1  ', title: '  Activity  ' }));
  assert.equal(valid.postId, 'post-1');
  assert.equal(valid.title, 'Activity');
});

test('bubble exists and is rendered + taps to post detail', () => {
  assert.equal(
    exists('src/features/chat/components/bubbles/plaza-post-card-bubble.tsx'),
    true,
  );
  const barrel = read('src/features/chat/components/chat-bubble.tsx');
  assert.match(barrel, /PlazaPostCardBubble/);
  const screen = read('src/features/chat/screens/ChatDetailScreen.tsx');
  assert.match(screen, /case 'plaza-post-card':/);
  assert.match(screen, /getPlazaPostDetailHref\(/);
});

test('pending-card store + chat consume + send card-then-text', () => {
  assert.equal(
    exists('src/features/chat/store/use-pending-chat-card-store.ts'),
    true,
  );
  const store = read('src/features/chat/store/use-pending-chat-card-store.ts');
  assert.match(store, /consumeFor/);
  assert.match(store, /conversationKey/);

  const screen = read('src/features/chat/screens/ChatDetailScreen.tsx');
  // 获焦按会话 key consume，并预填草稿（不覆盖非空）。
  assert.match(screen, /consumePendingChatCard\(sourceID\)/);
  assert.match(screen, /setDraft\(\(prev\) => prev \|\| cardPending\.draftText\)/);
  // 发送时先卡片后文字，空文字也能只发卡片。
  assert.match(screen, /sendPlazaPostCardMessage\(/);
  assert.match(screen, /\(!nextText && !pendingCard\)/);
});

test('signup → chat stages the post card + opener draft', () => {
  const screen = read('src/features/notifications/screens/PostSignupsScreen.tsx');
  assert.match(screen, /setPendingChatCard\(/);
  assert.match(screen, /conversationKey: signer\.userId/);
  assert.match(screen, /plaza\.signup\.chatOpener/);
  assert.match(screen, /toPlazaPostCardData\(/);
});

test('card has no general share entry — only the signup list creates it', () => {
  const detail = read('src/features/discover/screens/PlazaPostDetailScreen.tsx');
  // 帖子详情不再有「分享到聊天」入口。
  assert.doesNotMatch(detail, /shareToChat/);
  assert.doesNotMatch(detail, /forward-picker/);
  // 转发选择器也不再把 plaza-post-card 当可转发卡片。
  const picker = read('src/features/chat/screens/ForwardPickerScreen.tsx');
  assert.doesNotMatch(picker, /plaza-post-card/);
});

test('signup chat stages only for a resolved conversation or preview fallback', () => {
  const screen = read('src/features/notifications/screens/PostSignupsScreen.tsx');
  const handler = screen.slice(screen.indexOf('const openChat'), screen.indexOf('const openSignerProfile'));
  const resolution = handler.indexOf('await getOrCreateSingleConversation');
  const normalStage = handler.indexOf('setPendingChatCard', resolution);
  const normalNavigation = handler.indexOf('router.push', normalStage);
  const fallback = handler.indexOf('if (shouldOpenChatPreview');
  const fallbackStage = handler.indexOf('setPendingChatCard', fallback);
  const fallbackNavigation = handler.indexOf('router.push', fallbackStage);

  assert.equal(normalStage > resolution && normalStage < normalNavigation, true);
  assert.equal(handler.slice(0, resolution).includes('setPendingChatCard'), false);
  assert.equal(fallbackStage > fallback && fallbackStage < fallbackNavigation, true);
});

test('plaza detail missing route id starts in a stable error state', () => {
  const detail = read('src/features/discover/screens/PlazaPostDetailScreen.tsx');
  assert.match(detail, /useState\(Boolean\(id\)\)/);
  assert.match(detail, /useState<string \| null>\(id \? null :/);
  const missingIdBranch = detail.slice(
    detail.indexOf('if (!id) {'),
    detail.indexOf('setLoading(true)'),
  );
  assert.match(missingIdBranch, /setLoading\(false\)/);
  assert.match(missingIdBranch, /setError\(/);
  assert.match(missingIdBranch, /return;/);
  assert.doesNotMatch(missingIdBranch, /fetchPlazaPost\(/);
  assert.ok(detail.indexOf('fetchPlazaPost(id)') > detail.indexOf('setLoading(true)'));
});

test('i18n keys present in zh + en', () => {
  const zh = JSON.parse(read('src/i18n/locales/zh.json'));
  const en = JSON.parse(read('src/i18n/locales/en.json'));
  for (const d of [zh, en]) {
    assert.ok(d.plaza.signup.chatOpener);
    assert.ok(d.plaza.postDetail.title);
    assert.ok(d.chat.plazaPostCard.footer);
    assert.ok(d.im.preview.plazaPost);
  }
});
