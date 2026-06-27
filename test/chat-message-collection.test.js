const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadTsModule(relativePath) {
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
    require,
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('buildCollectionInputFromMessage stores voice OpenIM metadata without uploading again', () => {
  const { buildCollectionInputFromMessage } = loadTsModule(
    'src/features/chat/utils/message-collection.ts',
  );

  const input = buildCollectionInputFromMessage(
    {
      id: 'msg-voice-1',
      type: 'voice',
      outgoing: false,
      senderID: 'peer-1',
      senderName: 'Peer',
      time: '16:20',
      voiceUrl: 'https://cdn.example.com/voice.m4a',
      voicePath: '',
      voiceDuration: 4,
    },
    {
      conversationID: 'si_me_peer',
      conversationTitle: 'Peer Chat',
    },
  );

  assert.deepEqual(JSON.parse(JSON.stringify(input)), {
    type: 'VOICE',
    title: '语音消息',
    summary: '4 秒语音',
    sourceID: 'msg-voice-1',
    payload: {
      kind: 'openim-message',
      messageID: 'msg-voice-1',
      messageType: 'voice',
      conversationID: 'si_me_peer',
      conversationTitle: 'Peer Chat',
      senderID: 'peer-1',
      senderName: 'Peer',
      time: '16:20',
      voice: {
        sourceUrl: 'https://cdn.example.com/voice.m4a',
        soundPath: '',
        duration: 4,
      },
    },
  });
});

test('collected voice round-trips dataSize so re-sent remote voice is not 0KB', () => {
  const { buildCollectionInputFromMessage, getCollectedOpenIMMessagePayload } =
    loadTsModule('src/features/chat/utils/message-collection.ts');

  const input = buildCollectionInputFromMessage(
    {
      id: 'msg-voice-2',
      type: 'voice',
      outgoing: false,
      voiceUrl: 'https://cdn.example.com/voice.m4a',
      voicePath: '',
      voiceDuration: 4,
      voiceSize: 20480,
    },
    { conversationID: 'si_me_peer', conversationTitle: 'Peer Chat' },
  );

  assert.equal(input.payload.voice.dataSize, 20480);

  // And the reverse mapper recovers it for re-send.
  const recovered = getCollectedOpenIMMessagePayload(
    JSON.parse(JSON.stringify(input.payload)),
  );
  assert.equal(recovered.voice.dataSize, 20480);
});

test('re-sending a collected text message sends the original body once, not title+summary', () => {
  const { buildCollectionInputFromMessage, resolveCollectionSendPlan } =
    loadTsModule('src/features/chat/utils/message-collection.ts');

  // 文本消息的 title 与 summary 同源（都截自正文），曾经被拼成 `⭐ title\nsummary`，
  // 导致正文出现两遍。现在应直接发原文，不加任何装饰。
  const input = buildCollectionInputFromMessage(
    {
      id: 'msg-text-1',
      type: 'received',
      outgoing: false,
      text: '你好呀',
      time: '16:20',
    },
    { conversationID: 'si_me_peer', conversationTitle: 'Peer Chat' },
  );
  assert.equal(input.title, '你好呀');
  assert.equal(input.summary, '你好呀');

  const plan = resolveCollectionSendPlan({
    id: 'c1',
    title: input.title,
    summary: input.summary ?? null,
    payload: JSON.parse(JSON.stringify(input.payload)),
  });

  assert.equal(plan.kind, 'text');
  assert.equal(plan.text, '你好呀');
});

test('re-sending a collected voice rebuilds a voice message from its source url', () => {
  const { buildCollectionInputFromMessage, resolveCollectionSendPlan } =
    loadTsModule('src/features/chat/utils/message-collection.ts');

  const input = buildCollectionInputFromMessage(
    {
      id: 'msg-voice-3',
      type: 'voice',
      outgoing: false,
      voiceUrl: 'https://cdn.example.com/voice.m4a',
      voicePath: '',
      voiceDuration: 4,
      voiceSize: 20480,
    },
    { conversationID: 'si_me_peer', conversationTitle: 'Peer Chat' },
  );

  const plan = resolveCollectionSendPlan({
    id: 'c-voice',
    title: input.title,
    summary: input.summary ?? null,
    payload: JSON.parse(JSON.stringify(input.payload)),
  });

  assert.equal(plan.kind, 'voice');
  assert.equal(plan.sourceUrl, 'https://cdn.example.com/voice.m4a');
  assert.equal(plan.duration, 4);
  assert.equal(plan.dataSize, 20480);
});

test('re-sending a collected note card rebuilds the note card, not a text label', () => {
  const { buildCollectionInputFromMessage, resolveCollectionSendPlan } =
    loadTsModule('src/features/chat/utils/message-collection.ts');

  const noteCard = {
    noteId: 'note-1',
    ownerId: 'u-1',
    title: '我的笔记',
    contentPreview: '正文预览',
    coverUrl: null,
    imageCount: 0,
    videoCount: 0,
    groupNames: [],
  };
  const input = buildCollectionInputFromMessage(
    { id: 'msg-note-1', type: 'note-card', outgoing: false, noteCard },
    { conversationID: 'si_me_peer', conversationTitle: 'Peer Chat' },
  );

  const plan = resolveCollectionSendPlan({
    id: 'c-note',
    title: input.title,
    summary: input.summary ?? null,
    payload: JSON.parse(JSON.stringify(input.payload)),
  });

  assert.equal(plan.kind, 'note');
  assert.deepEqual(plan.noteCard, noteCard);
});

test('re-sending a collected friend card rebuilds the card payload', () => {
  const { buildCollectionInputFromMessage, resolveCollectionSendPlan } =
    loadTsModule('src/features/chat/utils/message-collection.ts');

  const friendCard = {
    userID: 'u-9',
    nickname: '小明',
    faceURL: 'https://cdn.example.com/a.png',
    persona: '产品经理',
    displayIcons: [],
  };
  const input = buildCollectionInputFromMessage(
    { id: 'msg-friend-1', type: 'friend-card', outgoing: false, friendCard },
    { conversationID: 'si_me_peer', conversationTitle: 'Peer Chat' },
  );

  const plan = resolveCollectionSendPlan({
    id: 'c-friend',
    title: input.title,
    summary: input.summary ?? null,
    payload: JSON.parse(JSON.stringify(input.payload)),
  });

  assert.equal(plan.kind, 'friend');
  assert.deepEqual(plan.friendCard, friendCard);
});

test('a collection with no rebuildable payload falls back to clean text without ⭐/title duplication', () => {
  const { resolveCollectionSendPlan } = loadTsModule(
    'src/features/chat/utils/message-collection.ts',
  );

  // 旧收藏 / 示例收藏：没有 openim payload，发摘要文本即可，不加 ⭐，不重复。
  const plan = resolveCollectionSendPlan({
    id: 'c2',
    title: '聊天记录收藏',
    summary: '聊天记录收藏',
    payload: { source: 'profile-collections' },
  });

  assert.equal(plan.kind, 'text');
  assert.equal(plan.text, '聊天记录收藏');
});
