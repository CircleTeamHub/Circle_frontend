const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// 消息 DTO → UI ChatMessage 的行为测试(vm harness,桩掉 i18n/url 工具)。
function transpile(rel) {
  const filePath = path.join(process.cwd(), rel);
  const source = fs.readFileSync(filePath, 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
}

function loadMappers() {
  const context = {
    Date,
    Number,
    module: { exports: {} },
    exports: {},
    require: (request) => {
      if (request === '@/services/api/utils') {
        return { normalizeMediaUrl: (u) => u ?? null };
      }
      if (request === './mappers') {
        return { formatChatTimestamp: () => '12:00' };
      }
      if (request === './store') return {};
      if (request === '@/types') return {};
      throw new Error(`unexpected require: ${request}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpile('src/chat-core/message-mappers.ts'), context);
  return context.module.exports;
}

function dto(overrides = {}) {
  return {
    id: overrides.id ?? 'm1',
    conversationId: 'c1',
    height: 5,
    type: 'text',
    content: { text: 'hi' },
    sender: { id: 'u2', nickname: '对方', avatarUrl: null },
    replyToId: null,
    d: null,
    createdAt: '2026-08-05T12:00:00.000Z',
    ...overrides,
  };
}

test('text messages split sent/received by sender identity', () => {
  const { mapChatMessageDtoToUI } = loadMappers();
  const received = mapChatMessageDtoToUI(dto(), 'u1', 0);
  assert.equal(received.type, 'received');
  assert.equal(received.senderName, '对方');

  const sent = mapChatMessageDtoToUI(
    dto({ sender: { id: 'u1', nickname: '我', avatarUrl: null } }),
    'u1',
    0,
  );
  assert.equal(sent.type, 'sent');
  assert.equal(sent.senderName, undefined);
  assert.equal(sent.sendStatus, 2);
});

test('optimistic lifecycle: sending → failed → confirmed statuses', () => {
  const { mapChatMessageDtoToUI } = loadMappers();
  const me = { id: 'u1', nickname: '我', avatarUrl: null };
  const sending = mapChatMessageDtoToUI(
    dto({ height: 0, sender: me, d: 'd1' }),
    'u1',
    0,
  );
  assert.equal(sending.sendStatus, 1);
  const failed = mapChatMessageDtoToUI(
    dto({ height: 0, sender: me, d: 'd1', failed: true }),
    'u1',
    0,
  );
  assert.equal(failed.sendStatus, 3);
});

test('image prefers server url and falls back to localUri while pending', () => {
  const { mapChatMessageDtoToUI } = loadMappers();
  const pending = mapChatMessageDtoToUI(
    dto({
      type: 'image',
      height: 0,
      content: { key: 'chat/a.jpg', localUri: 'file:///tmp/a.jpg' },
    }),
    'u1',
    0,
  );
  assert.equal(pending.imageUrl, 'file:///tmp/a.jpg');

  const confirmed = mapChatMessageDtoToUI(
    dto({
      type: 'image',
      content: {
        key: 'chat/a.jpg',
        url: 'https://signed/a.jpg',
        localUri: 'file:///tmp/a.jpg',
        width: 100,
        height: 80,
      },
    }),
    'u1',
    0,
  );
  assert.equal(confirmed.imageUrl, 'https://signed/a.jpg');
  assert.equal(confirmed.imageWidth, 100);
});

test('sent bubbles report isRead from the peer watermark', () => {
  const { mapChatMessageDtoToUI } = loadMappers();
  const me = { id: 'u1', nickname: '我', avatarUrl: null };
  assert.equal(
    mapChatMessageDtoToUI(dto({ sender: me, height: 5 }), 'u1', 5).isRead,
    true,
  );
  assert.equal(
    mapChatMessageDtoToUI(dto({ sender: me, height: 6 }), 'u1', 5).isRead,
    false,
  );
});

test('card content maps onto the matching UI field', () => {
  const { mapChatMessageDtoToUI } = loadMappers();
  const note = mapChatMessageDtoToUI(
    dto({ type: 'note-card', content: { noteId: 'n1', title: 'T' } }),
    'u1',
    0,
  );
  assert.equal(note.type, 'note-card');
  assert.equal(note.noteCard.noteId, 'n1');
});

test('list mapper renders newest-first and caches confirmed rows by reference', () => {
  const { createChatMessageMapCache, mapChatMessageDtosToUI } = loadMappers();
  const box = createChatMessageMapCache('u1');
  const a = dto({ id: 'a', height: 1 });
  const b = dto({ id: 'b', height: 2 });
  const first = mapChatMessageDtosToUI([a, b], 'u1', 0, box);
  assert.deepEqual(Array.from(first, (m) => m.id), ['b', 'a']);
  const second = mapChatMessageDtosToUI([a, b], 'u1', 0, box);
  // 同引用输入 → 同引用输出(FlatList 行级跳渲染的依据)。
  assert.equal(first[0], second[0]);
  assert.equal(first[1], second[1]);
  // 对端水位变化 → 整体失效重建(isRead 依赖水位)。
  const third = mapChatMessageDtosToUI([a, b], 'u1', 2, box);
  assert.notEqual(third[0], second[0]);
});
