const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// 聊天记录·媒体页的缩略图和气泡走的是同一份对端可控的 content。
// 拆栈时气泡侧补上了 allowPeerMediaUrl,媒体页却还停在 normalizeMediaUrl ——
// 而后者对「已经能直连的外部 https 地址」原样返回,于是同一个追踪信标
// 换个入口照样打得出去,而且媒体页是整屏格子一次性全请求。
function transpile(rel) {
  const filePath = path.join(process.cwd(), rel);
  return ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
}

function runModule(rel, requireImpl) {
  const context = {
    Date,
    Number,
    module: { exports: {} },
    exports: {},
    require: requireImpl,
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpile(rel), context);
  return context.module.exports;
}

function loadChatHistory() {
  // message-mappers 跑真实实现:localUri 的 scheme 白名单正是要断言的那条规则。
  const mappers = runModule('src/chat-core/message-mappers.ts', (request) => {
    if (request === '@/services/api/utils') {
      return {
        normalizeMediaUrl: (u) => u ?? null,
        allowPeerMediaUrl: () => null,
      };
    }
    if (request === '@/i18n') return { default: { t: (key) => key } };
    if (request === './mappers') return { formatChatTimestamp: () => '12:00' };
    if (request === './store') return {};
    if (request === '@/types') return {};
    // qr-payload 运行时零依赖,直接跑真实实现。
    if (request === '@/features/qr/qr-payload')
      return runModule('src/features/qr/qr-payload.ts', () => ({}));
    throw new Error(`unexpected require: ${request}`);
  });

  return runModule('src/features/chat/chat-history.ts', (request) => {
    if (request === '@/i18n') return { default: { t: (key) => key, language: 'zh' } };
    if (request === '@/chat-core/mappers') return { getChatMessagePreview: () => '' };
    if (request === '@/chat-core/message-mappers') return mappers;
    if (request === '@/services/api/utils') {
      return {
        // 白名单替身:只放行本站来源(与 hostile-card-payload.test.js 同款)。
        allowPeerMediaUrl: (u) =>
          typeof u === 'string' && u.startsWith('https://cdn.trusted/') ? u : null,
      };
    }
    if (request === '@/utils/locale') {
      return { getLocalizedDateTimeLocale: () => 'zh-CN' };
    }
    throw new Error(`unexpected require: ${request}`);
  });
}

// vm realm 里造出来的数组原型与宿主不同,deepEqual 会误报「结构相同但不同引用」。
function hostArray(value) {
  return Array.from(value);
}

function mediaMessage(content) {
  return {
    id: 'm1',
    conversationId: 'c1',
    height: 1,
    type: 'image',
    content,
    sender: { id: 'peer', nickname: '对方', avatarUrl: null },
    replyToId: null,
    d: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function videoMessage(content) {
  return { ...mediaMessage(content), type: 'video' };
}

test('untrusted thumbnail origins never reach the media grid', () => {
  const { getChatMediaThumbnailUris } = loadChatHistory();
  for (const content of [
    { thumbUrl: 'https://attacker.example/1x1.gif' },
    { url: 'http://attacker.example/beacon.png' },
    { thumbUrl: 'https://attacker.example/a.png', url: 'https://evil.example/b.png' },
    // localUri 被塞成网络地址是最直接的一种信标投放。
    { localUri: 'https://attacker.example/beacon.png' },
    { localUri: '//attacker.example/beacon.png' },
    { localUri: 'javascript:alert(1)' },
  ]) {
    assert.deepEqual(hostArray(getChatMediaThumbnailUris(mediaMessage(content))), []);
  }
});

test('trusted origins and device-local schemes still render', () => {
  const { getChatMediaThumbnailUris } = loadChatHistory();
  const trusted = getChatMediaThumbnailUris(
    mediaMessage({
      thumbUrl: 'https://cdn.trusted/thumb.jpg',
      url: 'https://cdn.trusted/full.jpg',
    }),
  );
  assert.deepEqual(hostArray(trusted), [
    'https://cdn.trusted/thumb.jpg',
    'https://cdn.trusted/full.jpg',
  ]);
  // 自己刚发出去的那条:远端还没签出来,本机文件路径可以直接预览。
  const local = getChatMediaThumbnailUris(
    mediaMessage({ localUri: 'file:///tmp/a.jpg' }),
  );
  assert.deepEqual(hostArray(local), ['file:///tmp/a.jpg']);
  assert.deepEqual(hostArray(getChatMediaThumbnailUris(mediaMessage({}))), []);
});

test('video files are never loaded as image thumbnails', () => {
  const { getChatMediaThumbnailUris } = loadChatHistory();
  assert.deepEqual(
    hostArray(
      getChatMediaThumbnailUris(
        videoMessage({
          url: 'https://cdn.trusted/movie.mp4',
          localUri: 'file:///tmp/movie.mov',
        }),
      ),
    ),
    [],
  );
  assert.deepEqual(
    hostArray(
      getChatMediaThumbnailUris(
        videoMessage({ thumbUrl: 'https://cdn.trusted/movie-poster.jpg' }),
      ),
    ),
    ['https://cdn.trusted/movie-poster.jpg'],
  );
});

test('media history requests the backend-supported image and video types', () => {
  const screen = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatHistoryMediaScreen.tsx'),
    'utf8',
  );
  assert.match(screen, /const MEDIA_HISTORY_TYPES = \['image', 'video'\]/);
  // 首屏 / 重试 / 翻页三条路径都用同一份常量,不再各写一份字面量。
  assert.equal(
    (screen.match(/types: MEDIA_HISTORY_TYPES/g) ?? []).length,
    3,
  );
});
