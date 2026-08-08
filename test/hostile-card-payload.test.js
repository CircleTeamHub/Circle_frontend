const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// 名片 payload 完全由对端构造 —— 服务端只管 content 的总字节数,不认识里面的形状。
// 拆栈前这层加固在 src/im/mappers.ts,自研栈把它挪到了 chat-core 的映射层;
// 这份用例跟着搬过来,保证「一条恶意消息不能把会话页永久搞坏」的保证不随迁移丢掉。
function loadMappers() {
  const filePath = path.join(process.cwd(), 'src/chat-core/message-mappers.ts');
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;

  const context = {
    Date,
    Number,
    module: { exports: {} },
    exports: {},
    require: (request) => {
      if (request === '@/services/api/utils') {
        return {
          normalizeMediaUrl: (u) => u ?? null,
          // 白名单替身:只放行本站来源。
          allowPeerMediaUrl: (u) =>
            typeof u === 'string' && u.startsWith('https://cdn.trusted/') ? u : null,
        };
      }
      if (request === '@/i18n') return { default: { t: (key) => key } };
      if (request === './mappers') return { formatChatTimestamp: () => '12:00' };
      if (request === './store') return {};
      if (request === '@/types') return {};
      throw new Error(`unexpected require: ${request}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context);
  return context.module.exports;
}

function friendCardDto(content) {
  return {
    id: 'm1',
    conversationId: 'c1',
    height: 1,
    type: 'friend-card',
    content,
    sender: { id: 'peer', nickname: '对方', avatarUrl: null },
    replyToId: null,
    d: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

test('hostile card payloads never throw during mapping', () => {
  const { mapChatMessageDtoToUI } = loadMappers();
  for (const content of [
    {},
    { displayIcons: 'not-an-array' },
    { displayIcons: 42 },
    { displayIcons: null },
    { displayIcons: [null, 1, 'x', {}] },
    { persona: { nested: true } },
    { nickname: [] },
  ]) {
    assert.doesNotThrow(() =>
      mapChatMessageDtoToUI(friendCardDto(content), 'me', 0),
    );
  }
});

test('displayIcons is always an array downstream, whatever the peer sent', () => {
  const { mapChatMessageDtoToUI } = loadMappers();
  // 塞成字符串时 bubble 的 `.length > 0` 会通过,而 `.slice(0,4).map` 在字符串上
  // 没有 map —— 一条消息就能把会话页打崩,且它已落库,每次进来都会再崩一次。
  for (const hostile of ['haha', 42, null, undefined, { 0: 'x' }]) {
    const ui = mapChatMessageDtoToUI(
      friendCardDto({ displayIcons: hostile }),
      'me',
      0,
    );
    assert.ok(Array.isArray(ui.friendCard.displayIcons));
  }
});

test('displayIcons is bounded no matter how many the peer sent', () => {
  const { mapChatMessageDtoToUI } = loadMappers();
  const many = Array.from({ length: 5000 }, (_, i) => ({
    id: `icon-${i}`,
    title: 'x',
  }));
  const ui = mapChatMessageDtoToUI(
    friendCardDto({ displayIcons: many }),
    'me',
    0,
  );
  // bubble 只渲染 4 个,映射层就不该把 5000 个整份带进渲染路径。
  assert.equal(ui.friendCard.displayIcons.length, 4);
});

test('only the fields consumers read survive sanitization', () => {
  const { mapChatMessageDtoToUI } = loadMappers();
  const ui = mapChatMessageDtoToUI(
    friendCardDto({
      displayIcons: [
        { id: 'i1', title: 't', junk: 'x'.repeat(1000), nested: { a: 1 } },
      ],
    }),
    'me',
    0,
  );
  const icon = ui.friendCard.displayIcons[0];
  assert.equal(icon.id, 'i1');
  // 不整份 spread 对端对象:没人读的字段不进内存。
  assert.equal(icon.junk, undefined);
  assert.equal(icon.nested, undefined);
});

test('persona is only ever a string or null', () => {
  const { mapChatMessageDtoToUI } = loadMappers();
  for (const persona of [{ nested: true }, [], 42, undefined]) {
    const ui = mapChatMessageDtoToUI(friendCardDto({ persona }), 'me', 0);
    const value = ui.friendCard.persona;
    assert.ok(value === null || typeof value === 'string');
  }
});

test('peer-controlled text is clamped before it reaches a bubble', () => {
  const { mapChatMessageDtoToUI } = loadMappers();
  const ui = mapChatMessageDtoToUI(
    friendCardDto({ nickname: 'x'.repeat(5000), persona: 'y'.repeat(5000) }),
    'me',
    0,
  );
  assert.ok(ui.friendCard.nickname.length <= 60);
  assert.ok((ui.friendCard.persona ?? '').length <= 120);
});

test('normal-length text is never truncated', () => {
  const { mapChatMessageDtoToUI } = loadMappers();
  const ui = mapChatMessageDtoToUI(
    friendCardDto({ nickname: '一波', persona: '在路上' }),
    'me',
    0,
  );
  assert.equal(ui.friendCard.nickname, '一波');
  assert.equal(ui.friendCard.persona, '在路上');
});

test('card avatars go through the media allowlist', () => {
  const { mapChatMessageDtoToUI } = loadMappers();
  const hostile = mapChatMessageDtoToUI(
    friendCardDto({ faceURL: 'https://attacker.example/beacon.gif' }),
    'me',
    0,
  );
  // 名片头像同样是对端可控的静默 GET 载体。
  assert.equal(hostile.friendCard.faceURL, '');

  const trusted = mapChatMessageDtoToUI(
    friendCardDto({ faceURL: 'https://cdn.trusted/a.jpg' }),
    'me',
    0,
  );
  assert.equal(trusted.friendCard.faceURL, 'https://cdn.trusted/a.jpg');
});
