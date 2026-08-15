const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const __localDbStub = {
  persistLocalConversations: async () => {},
  upsertLocalConversation: async () => {},
  removeLocalConversation: async () => {},
  persistLocalMessages: async () => {},
  deleteLocalMessage: async () => {},
  clearLocalConversationMessages: async () => {},
  deleteLocalMessagesBelow: async () => {},
  readRecentLocalMessages: async () => [],
  readLocalConversations: async () => [],
  searchLocalChatMessages: async () => [],
  outboxUpsert: async () => {},
  outboxDelete: async () => {},
  outboxList: async () => [],
  pendingReadUpsert: async () => {},
  pendingReadDelete: async () => {},
  pendingReadsList: async () => [],
  initChatLocalDb: async () => false,
  wipeChatLocalDb: async () => {},
};


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

function loadMappers(options = {}) {
  // 白名单替身:只放行「本站自己的媒体来源」,其余(含对端塞的任意主机)一律拒。
  const TRUSTED = ['https://cdn.trusted/', 'https://signed/'];
  const allow =
    options.allowPeerMediaUrl ??
    ((u) =>
      typeof u === 'string' && TRUSTED.some((prefix) => u.startsWith(prefix))
        ? u
        : null);
  const context = {
    Date,
    Number,
    module: { exports: {} },
    exports: {},
    require: (request) => {
      if (request === '@/services/api/utils') {
        return { normalizeMediaUrl: (u) => u ?? null, allowPeerMediaUrl: allow };
      }
      if (request === '@/i18n') {
        return {
          default: { t: (key, params) => (params?.names ? `${params.names} joined` : key) },
        };
      }
      if (request === './mappers') {
        return { formatChatTimestamp: () => '12:00' };
      }
      if (request === './store') return {};
      if (request === '@/types') return {};
      if (request === './local-db') return __localDbStub;
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

test('video messages preserve their signed source and playback metadata', () => {
  const { mapChatMessageDtoToUI } = loadMappers();
  const video = mapChatMessageDtoToUI(
    dto({
      type: 'video',
      content: {
        key: 'chat/u2/clip.mp4',
        url: 'https://cdn.trusted/clip.mp4',
        width: 1920,
        height: 1080,
        duration: 12,
        size: 2048,
      },
    }),
    'u1',
    0,
  );
  assert.equal(video.type, 'video');
  assert.equal(video.videoUrl, 'https://cdn.trusted/clip.mp4');
  assert.equal(video.videoWidth, 1920);
  assert.equal(video.videoHeight, 1080);
  assert.equal(video.videoDuration, 12);
  assert.equal(video.videoSize, 2048);
});

test('location messages preserve separate place details and valid coordinates', () => {
  const { mapChatMessageDtoToUI } = loadMappers();
  const location = mapChatMessageDtoToUI(
    dto({
      type: 'location',
      content: {
        title: '深圳湾公园',
        address: '广东省深圳市南山区滨海大道',
        description: '旧客户端兜底文案',
        latitude: 22.4806,
        longitude: 113.9464,
      },
    }),
    'u1',
    0,
  );

  assert.equal(location.locationTitle, '深圳湾公园');
  assert.equal(location.locationAddress, '广东省深圳市南山区滨海大道');
  assert.equal(location.locationLatitude, 22.4806);
  assert.equal(location.locationLongitude, 113.9464);
});

test('legacy location messages keep their description without inventing coordinates', () => {
  const { mapChatMessageDtoToUI } = loadMappers();
  const location = mapChatMessageDtoToUI(
    dto({
      type: 'location',
      content: { description: '深圳市南山区' },
    }),
    'u1',
    0,
  );

  assert.equal(location.locationTitle, '深圳市南山区');
  assert.equal(location.locationAddress, '深圳市南山区');
  assert.equal(location.locationLatitude, undefined);
  assert.equal(location.locationLongitude, undefined);
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

test('system messages render as localized system notices', () => {
  const { mapChatMessageDtoToUI } = loadMappers();
  const joined = mapChatMessageDtoToUI(
    dto({
      type: 'system',
      sender: null,
      content: { kind: 'member-joined', names: ['小明', '小红'] },
    }),
    'u1',
    0,
  );
  assert.equal(joined.type, 'system-notice');
  assert.match(joined.text, /小明、小红/);

  const left = mapChatMessageDtoToUI(
    dto({ type: 'system', sender: null, content: { kind: 'member-left' } }),
    'u1',
    0,
  );
  assert.equal(left.type, 'system-notice');
  assert.equal(left.text, 'im.notification.memberQuit');

  // 未知 kind:空文案隐藏,不渲染破位。
  const unknown = mapChatMessageDtoToUI(
    dto({ type: 'system', sender: null, content: { kind: 'future-kind' } }),
    'u1',
    0,
  );
  assert.equal(unknown.text, '');
});

test('maps server call-record messages onto the call-record bubble', () => {
  const { mapChatMessageDtoToUI } = loadMappers();
  const ui = mapChatMessageDtoToUI(
    dto({
      type: 'call-record',
      content: {
        callId: 'call-1',
        callType: 'VIDEO',
        sessionType: 'single',
        endReason: 'NORMAL',
        durationSeconds: 42,
        initiatorID: 'u1',
      },
    }),
    'u1',
    0,
  );
  // 缺这一支的话会掉进 default,渲染成一条空文本气泡 —— 通话记录整体消失。
  assert.equal(ui.type, 'call-record');
  assert.equal(ui.callRecord.callType, 'VIDEO');
  assert.equal(ui.callRecord.durationSeconds, 42);
});

test('falls back to a text bubble for a malformed call-record payload', () => {
  const { mapChatMessageDtoToUI } = loadMappers();
  for (const content of [
    { callId: 'c', callType: 'HOLOGRAM', sessionType: 'single', endReason: 'NORMAL', initiatorID: 'u1' },
    { callId: 'c', callType: 'AUDIO', sessionType: 'single', endReason: 'NOPE', initiatorID: 'u1' },
    { callType: 'AUDIO', sessionType: 'single', endReason: 'NORMAL', initiatorID: 'u1' },
  ]) {
    const ui = mapChatMessageDtoToUI(dto({ type: 'call-record', content }), 'u1', 0);
    // 半个对象不能塞给只认完整形状的 CallRecordBubble。
    assert.notEqual(ui.type, 'call-record');
  }
});

// ── 对端可控媒体地址:整个 content 由发送方构造,服务端只校验 object key ──────
test('image messages only render URLs that pass the media allowlist', () => {
  const { mapChatMessageDtoToUI } = loadMappers();

  const trusted = mapChatMessageDtoToUI(
    dto({ type: 'image', content: { key: 'k', url: 'https://cdn.trusted/a.jpg' } }),
    'u1',
    0,
  );
  assert.equal(trusted.imageUrl, 'https://cdn.trusted/a.jpg');

  // 签名失败时客户端塞的 url 会存活到这里,不能照单全收。
  const hostile = mapChatMessageDtoToUI(
    dto({ type: 'image', content: { key: 'k', url: 'https://attacker.example/1x1.gif' } }),
    'u1',
    0,
  );
  assert.equal(hostile.imageUrl, undefined);
});

test('localUri fallback only accepts host-less local schemes', () => {
  const { mapChatMessageDtoToUI } = loadMappers();

  // 自己发的那条:本机文件路径先顶上,这是这个回退存在的唯一理由。
  const local = mapChatMessageDtoToUI(
    dto({ type: 'image', content: { key: 'k', localUri: 'file:///tmp/a.jpg' } }),
    'u1',
    0,
  );
  assert.equal(local.imageUrl, 'file:///tmp/a.jpg');

  // 被塞成网络地址就是个静默追踪信标:每个滑过这条消息的人都会 GET 一次,
  // 把 IP、User-Agent 和精确到秒的已读时刻交给对方(不需要点击)。
  for (const beacon of [
    'https://attacker.example/beacon.gif',
    'http://attacker.example/beacon.gif',
    '//attacker.example/beacon.gif',
  ]) {
    const hostile = mapChatMessageDtoToUI(
      dto({ type: 'image', content: { key: 'k', localUri: beacon } }),
      'u1',
      0,
    );
    assert.equal(hostile.imageUrl, undefined, `must reject ${beacon}`);
  }
});

test('voice messages apply the same allowlist to both url and localUri', () => {
  const { mapChatMessageDtoToUI } = loadMappers();
  const hostile = mapChatMessageDtoToUI(
    dto({
      type: 'voice',
      content: {
        key: 'k',
        duration: 3,
        url: 'https://attacker.example/a.m4a',
        localUri: 'https://attacker.example/b.m4a',
      },
    }),
    'u1',
    0,
  );
  // 主地址被拒之后不能从 localUri 溜出去 —— 那正是绕过白名单的形态。
  assert.equal(hostile.voiceUrl ?? hostile.audioUrl ?? undefined, undefined);
});
