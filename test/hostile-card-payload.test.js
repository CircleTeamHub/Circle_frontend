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

test('every card type routes its image fields through the allowlist', () => {
  const { mapChatMessageDtoToUI } = loadMappers();
  const beacon = 'https://attacker.example/1x1.gif';
  const good = 'https://cdn.trusted/a.jpg';

  const cases = [
    ['note-card', 'noteCard', 'coverUrl'],
    ['circle-card', 'circleCard', 'avatarUrl'],
    ['plaza-post-card', 'plazaPostCard', 'coverUrl'],
  ];

  for (const [type, key, field] of cases) {
    const bad = mapChatMessageDtoToUI(
      { ...friendCardDto({ [field]: beacon }), type },
      'me',
      0,
    );
    // 收件方一打开会话就会自动请求这个地址,泄漏 IP 与查看时刻。
    assert.equal(bad[key][field], null, `${type} must reject the beacon`);

    const ok = mapChatMessageDtoToUI(
      { ...friendCardDto({ [field]: good }), type },
      'me',
      0,
    );
    assert.equal(ok[key][field], good, `${type} must keep trusted media`);
  }
});

// 卡片 payload 由发送方构造,服务端只管总字节数、不认识里面的形状。
// 字符串字段被塞成对象时 NoteCardBubble 的 `contentPreview.trim()` 直接抛 ——
// 一条消息打崩这个会话,而且它已落库,之后每次进来都会再崩一次。
test('every card type survives wrong-typed fields without throwing', () => {
  const { mapChatMessageDtoToUI } = loadMappers();
  const hostileValues = [{ nested: true }, [], 42, null, undefined, () => {}];

  for (const type of [
    'note-card',
    'circle-card',
    'plaza-post-card',
    'transfer-card',
    'verification-card',
  ]) {
    for (const value of hostileValues) {
      const content = {
        noteId: value,
        title: value,
        contentPreview: value,
        coverUrl: value,
        imageCount: value,
        videoCount: value,
        groupNames: value,
        circleId: value,
        name: value,
        avatarUrl: value,
        postId: value,
        circleName: value,
        city: value,
        signupCount: value,
        authorNickname: value,
        amount: value,
        message: value,
        invitationId: value,
        applicantName: value,
      };
      assert.doesNotThrow(
        () =>
          mapChatMessageDtoToUI({ ...friendCardDto(content), type }, 'me', 0),
        `${type} threw on ${String(value)}`,
      );
    }
  }
});

test('text fields are always strings, never objects handed to React', () => {
  const { mapChatMessageDtoToUI } = loadMappers();
  const ui = mapChatMessageDtoToUI(
    {
      ...friendCardDto({
        noteId: {},
        title: [],
        contentPreview: { toString: 1 },
        groupNames: 'not-an-array',
        imageCount: 'three',
      }),
      type: 'note-card',
    },
    'me',
    0,
  );
  const card = ui.noteCard;
  assert.equal(typeof card.noteId, 'string');
  assert.equal(typeof card.title, 'string');
  // NoteCardBubble 会对它调 .trim(),必须是 string 或 null。
  assert.ok(card.contentPreview === null || typeof card.contentPreview === 'string');
  assert.ok(Array.isArray(card.groupNames));
  assert.equal(typeof card.imageCount, 'number');
  assert.equal(Number.isFinite(card.imageCount), true);
});

test('transfer amounts never render as NaN or a negative number', () => {
  const { mapChatMessageDtoToUI } = loadMappers();
  for (const amount of [{}, 'free', NaN, Infinity, -5, undefined]) {
    const ui = mapChatMessageDtoToUI(
      { ...friendCardDto({ amount }), type: 'transfer-card' },
      'me',
      0,
    );
    assert.equal(typeof ui.transferCard.amount, 'number');
    assert.equal(Number.isFinite(ui.transferCard.amount), true);
    assert.ok(ui.transferCard.amount >= 0);
  }
});

test('card sanitization keeps well-formed values intact', () => {
  const { mapChatMessageDtoToUI } = loadMappers();
  const ui = mapChatMessageDtoToUI(
    {
      ...friendCardDto({
        noteId: 'n1',
        title: '标题',
        contentPreview: '正文预览',
        imageCount: 3,
        groupNames: ['a', 'b'],
        coverUrl: 'https://cdn.trusted/c.jpg',
      }),
      type: 'note-card',
    },
    'me',
    0,
  );
  assert.equal(ui.noteCard.noteId, 'n1');
  assert.equal(ui.noteCard.title, '标题');
  assert.equal(ui.noteCard.contentPreview, '正文预览');
  assert.equal(ui.noteCard.imageCount, 3);
  assert.deepEqual([...ui.noteCard.groupNames], ['a', 'b']);
  assert.equal(ui.noteCard.coverUrl, 'https://cdn.trusted/c.jpg');
});
