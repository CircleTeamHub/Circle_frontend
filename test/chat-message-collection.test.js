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
    // message-collection.ts imports @/i18n (full i18next runtime); stub a defaultValue-echoing
    // t() and pass everything else through to the real require.
    require: (specifier) => {
      if (specifier === '@/i18n') {
        return {
          __esModule: true,
          default: { t: (key, opts) => { let s = (opts && opts.defaultValue) || key; if (opts) for (const k of Object.keys(opts)) if (k !== 'defaultValue') s = s.split('{{' + k + '}}').join(String(opts[k])); return s; }, language: 'zh' },
        };
      }
      return require(specifier);
    },
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

test('chat-sourced collections preserve conversation route context for locating the original message', () => {
  const { buildCollectionInputFromMessage, getCollectedOpenIMMessagePayload } =
    loadTsModule('src/features/chat/utils/message-collection.ts');

  const input = buildCollectionInputFromMessage(
    {
      id: 'msg-text-2',
      type: 'received',
      outgoing: false,
      senderID: 'sender-1',
      senderName: '发送人',
      time: '18:30',
      text: '群里的重要消息',
    },
    {
      conversationID: 'sg_group-1',
      conversationTitle: '项目群',
      sourceID: 'group-1',
      conversationType: 'group',
    },
  );

  const recovered = getCollectedOpenIMMessagePayload(
    JSON.parse(JSON.stringify(input.payload)),
  );

  assert.equal(recovered.messageID, 'msg-text-2');
  assert.equal(recovered.conversationID, 'sg_group-1');
  assert.equal(recovered.conversationTitle, '项目群');
  assert.equal(recovered.sourceID, 'group-1');
  assert.equal(recovered.conversationType, 'group');
  assert.equal(recovered.senderID, 'sender-1');
  assert.equal(recovered.senderName, '发送人');
  assert.equal(recovered.time, '18:30');
});

// ── 收藏笔记 → 我的笔记（collectNote）────────────────────────────────────────

test('note-card messages no longer produce a collection item (they go to My Notes)', () => {
  const { buildCollectionInputFromMessage } = loadTsModule(
    'src/features/chat/utils/message-collection.ts',
  );

  const input = buildCollectionInputFromMessage(
    {
      id: 'msg-note-1',
      type: 'note-card',
      outgoing: false,
      noteCard: {
        noteId: 'note-1',
        ownerId: 'owner-1',
        title: '笔记',
        contentPreview: null,
        coverUrl: null,
        imageCount: 0,
        videoCount: 0,
        groupNames: [],
      },
    },
    { conversationID: 'si_me_peer', conversationTitle: 'Peer Chat' },
  );

  assert.equal(input, null);
});

test('buildNoteCollectSource carries the group card and actual sender for group chats', () => {
  const { buildNoteCollectSource } = loadTsModule(
    'src/features/chat/utils/message-collection.ts',
  );

  const source = buildNoteCollectSource(
    {
      id: 'msg-note-9',
      type: 'note-card',
      outgoing: false,
      senderID: 'user-2',
      senderName: '小王',
      noteCard: { noteId: 'note-9', title: 'T' },
    },
    {
      conversationID: 'sg_group-1',
      conversationTitle: '产品讨论群',
      sourceID: 'group-1',
      conversationType: 'group',
      conversationAvatarUrl: 'https://cdn.example.com/group.png',
    },
  );

  assert.deepEqual(JSON.parse(JSON.stringify(source)), {
    conversationType: 'group',
    conversationID: 'sg_group-1',
    clientMsgID: 'msg-note-9',
    sender: { id: 'user-2', name: '小王' },
    group: {
      id: 'group-1',
      name: '产品讨论群',
      faceURL: 'https://cdn.example.com/group.png',
    },
  });
});

test('buildNoteCollectSource uses the conversation peer as the card for private chats', () => {
  const { buildNoteCollectSource } = loadTsModule(
    'src/features/chat/utils/message-collection.ts',
  );

  const source = buildNoteCollectSource(
    {
      id: 'msg-note-10',
      type: 'note-card',
      outgoing: false,
      senderID: 'peer-1',
      senderName: '好友A',
      noteCard: { noteId: 'note-10', title: 'T' },
    },
    {
      conversationID: 'si_me_peer',
      conversationTitle: '好友A',
      sourceID: 'peer-1',
      conversationType: 'private',
      conversationAvatarUrl: 'https://cdn.example.com/a.png',
    },
  );

  assert.deepEqual(JSON.parse(JSON.stringify(source)), {
    conversationType: 'private',
    conversationID: 'si_me_peer',
    clientMsgID: 'msg-note-10',
    sender: {
      id: 'peer-1',
      name: '好友A',
      faceURL: 'https://cdn.example.com/a.png',
    },
  });
});

test('buildNoteCollectSource falls back to the current user for own group messages and drops non-http faceURL', () => {
  const { buildNoteCollectSource } = loadTsModule(
    'src/features/chat/utils/message-collection.ts',
  );

  // 自己发的群消息没有 senderID → sender 回落到当前用户；
  // 本地文件路径头像不是合法 URL → 不上送（后端 IsUrl 校验会 400）。
  const source = buildNoteCollectSource(
    {
      id: 'msg-note-11',
      type: 'note-card',
      outgoing: true,
      noteCard: { noteId: 'note-11', title: 'T' },
    },
    {
      conversationID: 'sg_group-1',
      conversationTitle: '产品讨论群',
      sourceID: 'group-1',
      conversationType: 'group',
      conversationAvatarUrl: 'file:///local/group.png',
      currentUser: { id: 'me-1', name: '', faceURL: 'file:///me.png' },
    },
  );

  assert.deepEqual(JSON.parse(JSON.stringify(source)), {
    conversationType: 'group',
    conversationID: 'sg_group-1',
    clientMsgID: 'msg-note-11',
    sender: { id: 'me-1', name: 'me-1' },
    group: { id: 'group-1', name: '产品讨论群' },
  });
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

test('re-sending a collected voice rebuilds it from the stored object key', () => {
  const { buildCollectionInputFromMessage, resolveCollectionSendPlan, canResendCollection } =
    loadTsModule('src/features/chat/utils/message-collection.ts');

  // 自研栈重发语音只认 object key:voiceUrl 是服务端现签的临时地址,
  // 过期即失效、也推不回 key,所以收藏时必须把 key 一起存下来。
  const input = buildCollectionInputFromMessage(
    {
      id: 'msg-voice-3',
      type: 'voice',
      outgoing: false,
      voiceUrl: 'https://cdn.example.com/voice.m4a?sig=expiring',
      voicePath: '',
      voiceDuration: 4,
      voiceSize: 20480,
    },
    {
      conversationID: 'si_me_peer',
      conversationTitle: 'Peer Chat',
      voiceKey: 'chat/u-1/voice.m4a',
    },
  );

  const collection = {
    id: 'c-voice',
    title: input.title,
    summary: input.summary ?? null,
    payload: JSON.parse(JSON.stringify(input.payload)),
  };
  const plan = resolveCollectionSendPlan(collection);

  assert.equal(plan.kind, 'voice');
  assert.equal(plan.key, 'chat/u-1/voice.m4a');
  assert.equal(plan.duration, 4);
  assert.equal(plan.dataSize, 20480);
  assert.equal(canResendCollection(collection), true);
});

test('a legacy voice favorite is an explicit unsupported plan, not a retryable failure', () => {
  const { buildCollectionInputFromMessage, resolveCollectionSendPlan, canResendCollection } =
    loadTsModule('src/features/chat/utils/message-collection.ts');

  // OpenIM 时代(以及本次修复之前)的语音收藏没有 key。之前这里会走进发送流程
  // 再 throw,被统一渲染成「发送失败,请重试」—— 而重试多少次都不可能成功。
  const input = buildCollectionInputFromMessage(
    {
      id: 'msg-voice-legacy',
      type: 'voice',
      outgoing: false,
      voiceUrl: 'https://openim.gone.example/voice.m4a',
      voicePath: '',
      voiceDuration: 4,
    },
    { conversationID: 'si_me_peer', conversationTitle: 'Peer Chat' },
  );
  assert.equal(input.payload.voice.key, undefined);

  const collection = {
    id: 'c-voice-legacy',
    title: input.title,
    summary: input.summary ?? null,
    payload: JSON.parse(JSON.stringify(input.payload)),
  };
  const plan = resolveCollectionSendPlan(collection);
  assert.equal(plan.kind, 'unsupported');
  assert.equal(plan.reason, 'legacy-voice');
  // 选择器据此禁用该行,不把一个必然失败的入口先亮出来。
  assert.equal(canResendCollection(collection), false);
});

test('the favorites picker disables rows that can never be re-sent', () => {
  const picker = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/SharePickerScreen.tsx'),
    'utf8',
  );
  assert.match(picker, /canResendCollection\(item\)/);
  assert.match(picker, /disabled=\{!resendable\}/);
  assert.match(picker, /share\.favoriteLegacyVoiceUnsupported/);

  const chat = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatDetailScreen.tsx'),
    'utf8',
  );
  // 屏幕侧双保险:unsupported 在进入 try/catch 之前就被拦下,
  // 不会被 getChatSendErrorMessage 包成一句「请重试」。
  assert.match(chat, /if \(plan\.kind === 'unsupported'\)/);
  assert.match(chat, /chat\.detail\.favoriteLegacyVoiceUnsupported/);
  assert.doesNotMatch(chat, /voice favorite resend not yet supported/);
  // 有 key 的语音收藏真的能重发。
  assert.match(chat, /key: plan\.key/);
});

test('re-sending a LEGACY collected note card still rebuilds the note card (old rows in DB)', () => {
  const { resolveCollectionSendPlan } = loadTsModule(
    'src/features/chat/utils/message-collection.ts',
  );

  // 新收藏不再产生 NOTE 收藏项，但历史数据仍可能带 note-card payload；
  // send plan 保留还原能力作为兜底。
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
  const plan = resolveCollectionSendPlan({
    id: 'c-note',
    title: '我的笔记',
    summary: '正文预览',
    payload: {
      kind: 'openim-message',
      messageID: 'msg-note-1',
      messageType: 'note-card',
      conversationID: 'si_me_peer',
      conversationTitle: 'Peer Chat',
      noteCard,
    },
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
