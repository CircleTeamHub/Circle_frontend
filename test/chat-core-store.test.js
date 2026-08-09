const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// 与 im-store-message-merge.test.js 同款 harness:真源码 + zustand 极简桩,
// 在 vm 里执行,断言 store 行为而非源码字符串。
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

function zustandStub() {
  const makeStore = (initializer) => {
    const state = {};
    const set = (partial) => {
      const next = typeof partial === 'function' ? partial(state) : partial;
      Object.assign(state, next);
    };
    const get = () => state;
    Object.assign(state, initializer(set, get));
    return { getState: get, setState: set };
  };
  return {
    // create(initializer) 与 create<T>()(initializer) 两种写法都要吃下。
    create: (initializer) =>
      initializer === undefined ? makeStore : makeStore(initializer),
  };
}

/** persist 中间件在 vm 里退化成直通:只测行为,不测 MMKV 落盘。 */
function zustandMiddlewareStub() {
  return {
    persist: (initializer) => initializer,
    createJSONStorage: () => ({}),
  };
}

function runModule(rel, requireImpl) {
  const context = {
    Date,
    module: { exports: {} },
    exports: {},
    require: requireImpl,
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpile(rel), context);
  return context.module.exports;
}

function loadChatStore() {
  // 墓碑模块跑真实实现（同一个 vm 实例内共享），删除行为才是真被断言的。
  const deletedMessages = runModule('src/chat-core/deleted-messages.ts', (request) => {
    if (request === 'zustand') return zustandStub();
    if (request === 'zustand/middleware') return zustandMiddlewareStub();
    if (request === '@/storage') return { mmkvJsonStorage: {} };
    // 墓碑超上限时会报一次(淘汰=消息复活,必须可观测)。
    if (request === '@/observability/sentry') return { reportError: () => {} };
    throw new Error(`unexpected require: ${request}`);
  });
  const store = runModule('src/chat-core/store.ts', (request) => {
    if (request === 'zustand') return zustandStub();
    if (request === './deleted-messages') return deletedMessages;
    if (request === './protocol') {
      // protocol.ts 零依赖,直接同环境执行。
      return runModule('src/chat-core/protocol.ts', () => {
        throw new Error('protocol should have no runtime deps');
      });
    }
    throw new Error(`unexpected require: ${request}`);
  });
  return { ...store, ...deletedMessages };
}

function msg(overrides = {}) {
  return {
    id: overrides.id ?? `msg-${Math.random().toString(36).slice(2, 8)}`,
    conversationId: 'conv-1',
    height: 1,
    type: 'text',
    content: { text: 'hi' },
    sender: null,
    replyToId: null,
    d: null,
    createdAt: '2026-08-05T12:00:00.000Z',
    ...overrides,
  };
}

function conversation(overrides = {}) {
  return {
    id: 'conv-1',
    type: 'DIRECT',
    peer: { id: 'other', nickname: '对方', avatarUrl: null },
    circleId: null,
    circle: null,
    lastMessage: null,
    unreadCount: 0,
    pinned: false,
    muted: false,
    lastMessageAt: null,
    ...overrides,
  };
}

test('ingestMessages sorts by height and dedupes by id', () => {
  const { useChatStore } = loadChatStore();
  const store = useChatStore.getState();
  store.ingestMessages('conv-1', [
    msg({ id: 'b', height: 2 }),
    msg({ id: 'a', height: 1 }),
  ]);
  store.ingestMessages('conv-1', [
    msg({ id: 'b', height: 2, content: { text: 'updated' } }),
    msg({ id: 'c', height: 3 }),
  ]);
  const messages = useChatStore.getState().messagesByConversation['conv-1'];
  assert.deepEqual(Array.from(messages, (m) => m.id), ['a', 'b', 'c']);
  assert.equal(messages[1].content.text, 'updated');
});

test('server echo with the same d replaces the local optimistic message', () => {
  const { useChatStore } = loadChatStore();
  const store = useChatStore.getState();
  // 本地乐观占位:height=0,id 为本地临时 id。
  store.ingestMessages('conv-1', [msg({ id: 'local:d1', height: 0, d: 'd1' })]);
  // 服务端广播/回执:同 d,真 id 与 height。
  store.ingestMessages('conv-1', [msg({ id: 'srv-9', height: 9, d: 'd1' })]);
  const messages = useChatStore.getState().messagesByConversation['conv-1'];
  assert.deepEqual(Array.from(messages, (m) => m.id), ['srv-9']);
  assert.equal(messages[0].height, 9);
});

test('optimistic (height=0) messages sort after confirmed ones', () => {
  const { useChatStore } = loadChatStore();
  const store = useChatStore.getState();
  store.ingestMessages('conv-1', [
    msg({ id: 'local:d2', height: 0, d: 'd2', createdAt: '2026-08-05T12:01:00.000Z' }),
    msg({ id: 'srv-5', height: 5 }),
  ]);
  const messages = useChatStore.getState().messagesByConversation['conv-1'];
  assert.deepEqual(Array.from(messages, (m) => m.id), ['srv-5', 'local:d2']);
});

test('caps per-conversation messages at 200 keeping the newest', () => {
  const { useChatStore, MESSAGES_CAP } = loadChatStore();
  const store = useChatStore.getState();
  const batch = [];
  for (let height = 1; height <= 250; height += 1) {
    batch.push(msg({ id: `m-${height}`, height }));
  }
  store.ingestMessages('conv-1', batch);
  const messages = useChatStore.getState().messagesByConversation['conv-1'];
  assert.equal(messages.length, MESSAGES_CAP);
  assert.equal(messages[0].height, 51);
  assert.equal(messages[messages.length - 1].height, 250);
});

test('untouched conversations keep their array reference (ref stability)', () => {
  const { useChatStore } = loadChatStore();
  const store = useChatStore.getState();
  store.ingestMessages('conv-1', [msg({ id: 'a' })]);
  store.ingestMessages('conv-2', [msg({ id: 'x', conversationId: 'conv-2' })]);
  const before = useChatStore.getState().messagesByConversation['conv-1'];
  store.ingestMessages('conv-2', [msg({ id: 'y', conversationId: 'conv-2', height: 2 })]);
  const after = useChatStore.getState().messagesByConversation['conv-1'];
  assert.equal(before, after);
});

test('applyRead advances per-user watermarks forward only', () => {
  const { useChatStore } = loadChatStore();
  const store = useChatStore.getState();
  store.applyRead('conv-1', 'u2', 5);
  store.applyRead('conv-1', 'u2', 3);
  assert.equal(useChatStore.getState().readWatermarks['conv-1']['u2'], 5);
  store.applyRead('conv-1', 'u2', 8);
  assert.equal(useChatStore.getState().readWatermarks['conv-1']['u2'], 8);
});

test('reset clears everything', () => {
  const { useChatStore } = loadChatStore();
  const store = useChatStore.getState();
  store.setCurrentUserId('u1');
  store.ingestMessages('conv-1', [msg({ id: 'a' })]);
  store.reset();
  const state = useChatStore.getState();
  assert.equal(state.currentUserId, null);
  // vm realm 里创建的 {} 原型与宿主不同,deepEqual 会误报,改断言键数。
  assert.equal(Object.keys(state.messagesByConversation).length, 0);
  assert.equal(state.connected, false);
});

test('applyIncomingMessage reports an unknown conversation instead of silently dropping it', () => {
  const { useChatStore } = loadChatStore();
  const store = useChatStore.getState();
  store.setConversations([]);
  // 返回 false 是分发器去补拉会话元信息的信号;没有它消息进了时间线,
  // 但会话行和角标一直不出现,要手动刷新才看得到。
  assert.equal(store.applyIncomingMessage(msg({ id: 'a', height: 1 })), false);
});

test('applyIncomingMessage does not inflate unread on a duplicate delivery', () => {
  const { useChatStore } = loadChatStore();
  const store = useChatStore.getState();
  store.setCurrentUserId('me');
  store.setConversations([conversation()]);
  const incoming = msg({ id: 'dup', height: 5, sender: { id: 'other' } });

  // 分发器的顺序:先联动会话列表,再入时间线。
  store.applyIncomingMessage(incoming);
  store.ingestMessages('conv-1', [incoming]);
  assert.equal(useChatStore.getState().conversations[0].unreadCount, 1);

  // 重复投递:时间线按 id 去重,角标也不该再涨。
  store.applyIncomingMessage(incoming);
  store.ingestMessages('conv-1', [incoming]);
  assert.equal(useChatStore.getState().conversations[0].unreadCount, 1);
});

test('applyIncomingMessage keeps the preview monotonic by height', () => {
  const { useChatStore } = loadChatStore();
  const store = useChatStore.getState();
  store.setCurrentUserId('me');
  store.setConversations([conversation()]);

  store.applyIncomingMessage(msg({ id: 'newer', height: 9, sender: { id: 'other' } }));
  assert.equal(useChatStore.getState().conversations[0].lastMessage.id, 'newer');

  // 迟到的旧消息不该把会话拉回去、把预览显示成过期的那一条。
  store.applyIncomingMessage(msg({ id: 'older', height: 4, sender: { id: 'other' } }));
  assert.equal(useChatStore.getState().conversations[0].lastMessage.id, 'newer');
});

test('revertConversationPreview falls back to the last authoritative message', () => {
  const { useChatStore } = loadChatStore();
  const store = useChatStore.getState();
  store.setCurrentUserId('me');
  store.setConversations([conversation()]);

  const confirmed = msg({ id: 'real', height: 7, sender: { id: 'me' } });
  store.ingestMessages('conv-1', [confirmed]);
  store.applyIncomingMessage(confirmed);

  // 乐观消息把预览换成了自己,随后发送失败。
  const optimistic = msg({ id: 'local:d1', height: 0, d: 'd1', sender: { id: 'me' } });
  store.ingestMessages('conv-1', [optimistic]);
  store.applyIncomingMessage(optimistic);
  assert.equal(useChatStore.getState().conversations[0].lastMessage.id, 'local:d1');

  store.markMessageFailed('conv-1', 'd1');
  store.revertConversationPreview('conv-1');
  // 不回滚的话会话列表会把服务端可能根本没有的内容当成最新消息。
  assert.equal(useChatStore.getState().conversations[0].lastMessage.id, 'real');
});

test('clearCachedChats keeps the session identity that reset would destroy', () => {
  const { useChatStore } = loadChatStore();
  const store = useChatStore.getState();
  store.setCurrentUserId('me');
  store.setConnected(true);
  store.setConversations([conversation()]);
  store.ingestMessages('conv-1', [msg({ id: 'a', height: 1 })]);

  store.clearCachedChats();
  const state = useChatStore.getState();
  assert.equal(state.conversations.length, 0);
  assert.equal(Object.keys(state.messagesByConversation).length, 0);
  // socket 还连着:清掉 currentUserId 的话之后的消息判不出收发方向。
  assert.equal(state.currentUserId, 'me');
  assert.equal(state.connected, true);
});

test('a locally deleted message stays hidden when history is reloaded', () => {
  const { useChatStore } = loadChatStore();
  const store = useChatStore.getState();
  store.setConversations([conversation()]);
  store.ingestMessages('conv-1', [
    msg({ id: 'keep', height: 1 }),
    msg({ id: 'gone', height: 2 }),
  ]);

  store.removeMessage('conv-1', 'gone');
  assert.deepEqual(
    Array.from(useChatStore.getState().messagesByConversation['conv-1'], (m) => m.id),
    ['keep'],
  );

  // 重进会话 = 再拉一次同样的历史。只从数组里摘掉的话它当场复活。
  store.ingestMessages('conv-1', [
    msg({ id: 'keep', height: 1 }),
    msg({ id: 'gone', height: 2 }),
  ]);
  assert.deepEqual(
    Array.from(useChatStore.getState().messagesByConversation['conv-1'], (m) => m.id),
    ['keep'],
  );
});

test('deleting the previewed message rolls the conversation preview back', () => {
  const { useChatStore } = loadChatStore();
  const store = useChatStore.getState();
  store.setConversations([conversation()]);
  const older = msg({ id: 'older', height: 1 });
  const newest = msg({ id: 'newest', height: 2 });
  store.ingestMessages('conv-1', [older, newest]);
  store.applyIncomingMessage(newest);
  assert.equal(useChatStore.getState().conversations[0].lastMessage.id, 'newest');

  store.removeMessage('conv-1', 'newest');
  // 不退预览的话消息页继续把已经删掉的内容当最新消息展示。
  assert.equal(useChatStore.getState().conversations[0].lastMessage.id, 'older');
});

test('a REST snapshot cannot resurrect a deleted message as the preview', () => {
  const { useChatStore } = loadChatStore();
  const store = useChatStore.getState();
  store.setConversations([conversation()]);
  const older = msg({ id: 'older', height: 1 });
  const deleted = msg({ id: 'deleted', height: 2 });
  store.ingestMessages('conv-1', [older, deleted]);
  store.removeMessage('conv-1', 'deleted');

  // 下拉刷新:服务端并不知道本端删过什么,快照里 lastMessage 还是那条。
  store.setConversations([
    conversation({ lastMessage: deleted, lastMessageAt: deleted.createdAt }),
  ]);
  assert.equal(useChatStore.getState().conversations[0].lastMessage.id, 'older');

  // 时间线里也没有可退的了:只留时间,预览留空,不再展示已删内容。
  store.clearCachedChats();
  store.setConversations([
    conversation({ lastMessage: deleted, lastMessageAt: deleted.createdAt }),
  ]);
  assert.equal(useChatStore.getState().conversations[0].lastMessage, null);
  assert.equal(
    useChatStore.getState().conversations[0].lastMessageAt,
    deleted.createdAt,
  );
});

test('a redelivered deleted message neither returns nor inflates unread', () => {
  const { useChatStore } = loadChatStore();
  const store = useChatStore.getState();
  store.setCurrentUserId('me');
  store.setConversations([conversation()]);
  const incoming = msg({ id: 'gone', height: 3, sender: { id: 'other' } });
  store.applyIncomingMessage(incoming);
  store.ingestMessages('conv-1', [incoming]);
  store.markConversationReadLocal('conv-1');
  store.removeMessage('conv-1', 'gone');

  store.applyIncomingMessage(incoming);
  store.ingestMessages('conv-1', [incoming]);
  assert.equal(useChatStore.getState().conversations[0].unreadCount, 0);
  assert.equal(
    (useChatStore.getState().messagesByConversation['conv-1'] ?? []).length,
    0,
  );
});

test('tombstones stay bounded so long-lived installs cannot grow unbounded', () => {
  const { useChatStore, DELETED_MESSAGES_CAP, useDeletedMessagesStore } =
    loadChatStore();
  const store = useChatStore.getState();
  for (let i = 0; i < DELETED_MESSAGES_CAP + 25; i += 1) {
    store.removeMessage('conv-1', `m-${i}`);
  }
  const kept = Object.keys(useDeletedMessagesStore.getState().deletedAtById);
  assert.equal(kept.length, DELETED_MESSAGES_CAP);
  // 淘汰最旧的那批,最近删的一定还在。
  assert.ok(kept.includes(`m-${DELETED_MESSAGES_CAP + 24}`));
});

test('older history pages survive the message cap (pagination actually works)', () => {
  const { useChatStore, MESSAGES_CAP } = loadChatStore();
  const store = useChatStore.getState();

  // 先灌满窗口:200 条最新消息。
  const newest = Array.from({ length: MESSAGES_CAP }, (_, i) =>
    msg({ id: `new-${i}`, height: 1000 + i }),
  );
  store.ingestMessages('conv-1', newest);
  assert.equal(useChatStore.getState().messagesByConversation['conv-1'].length, MESSAGES_CAP);

  // 再翻一页更早的:排序后它们在窗口之前,固定 200 的截断会把整页当场丢掉,
  // 而游标照常前进 —— 表现就是「越滚越请求、永远看不到第 201 条以前」。
  const older = Array.from({ length: 50 }, (_, i) =>
    msg({ id: `old-${i}`, height: 100 + i }),
  );
  store.ingestMessages('conv-1', older);

  const merged = useChatStore.getState().messagesByConversation['conv-1'];
  assert.equal(merged.length, MESSAGES_CAP + 50);
  assert.equal(merged[0].id, 'old-0');
});

test('the window stops growing at the hard ceiling', () => {
  const { useChatStore, MESSAGES_WINDOW_MAX } = loadChatStore();
  const store = useChatStore.getState();
  store.ingestMessages('conv-1', [msg({ id: 'anchor', height: 999999 })]);
  // 一路往前翻,窗口不能无限长大到把整个会话读进内存。
  for (let page = 0; page < 30; page += 1) {
    const older = Array.from({ length: 200 }, (_, i) =>
      msg({ id: `p${page}-${i}`, height: 500000 - page * 1000 + i }),
    );
    store.ingestMessages('conv-1', older);
  }
  const merged = useChatStore.getState().messagesByConversation['conv-1'];
  assert.ok(merged.length <= MESSAGES_WINDOW_MAX, `window ${merged.length}`);
});

test('realtime messages do not grow the window', () => {
  const { useChatStore, MESSAGES_CAP } = loadChatStore();
  const store = useChatStore.getState();
  store.ingestMessages(
    'conv-1',
    Array.from({ length: MESSAGES_CAP }, (_, i) => msg({ id: `n-${i}`, height: 100 + i })),
  );
  // 新消息是「更新」不是「翻页」:窗口保持不变,最旧的滚出去。
  store.ingestMessages('conv-1', [msg({ id: 'live', height: 99999 })]);
  const merged = useChatStore.getState().messagesByConversation['conv-1'];
  assert.equal(merged.length, MESSAGES_CAP);
  assert.equal(merged[merged.length - 1].id, 'live');
});

test('deleting an unconfirmed bubble survives its ack replacing the id', () => {
  const { useChatStore } = loadChatStore();
  const store = useChatStore.getState();
  store.setCurrentUserId('me');
  store.setConversations([conversation()]);

  // 乐观消息:id 是临时的 local:<d>,服务端还没给真 id。
  const optimistic = msg({ id: 'local:d-1', height: 0, d: 'd-1', sender: { id: 'me' } });
  store.ingestMessages('conv-1', [optimistic]);
  store.removeMessage('conv-1', 'local:d-1');
  assert.equal(useChatStore.getState().messagesByConversation['conv-1'].length, 0);

  // ack 回来了,带的是一个全新的服务端 id —— 只按 id 记墓碑的话它会溜回来,
  // 删除在慢网下当着用户的面自己撤销。
  const confirmed = msg({ id: 'server-1', height: 7, d: 'd-1', sender: { id: 'me' } });
  store.ingestMessages('conv-1', [confirmed]);
  assert.equal(useChatStore.getState().messagesByConversation['conv-1'].length, 0);
});

test('the same holds when the server echo beats the ack', () => {
  const { useChatStore } = loadChatStore();
  const store = useChatStore.getState();
  store.setCurrentUserId('me');
  store.setConversations([conversation()]);

  store.ingestMessages('conv-1', [
    msg({ id: 'local:d-2', height: 0, d: 'd-2', sender: { id: 'me' } }),
  ]);
  store.removeMessage('conv-1', 'local:d-2');

  // 回声先到(广播),同样带着 d 和新的服务端 id。
  store.applyIncomingMessage(msg({ id: 'echo-1', height: 8, d: 'd-2', sender: { id: 'me' } }));
  store.ingestMessages('conv-1', [
    msg({ id: 'echo-1', height: 8, d: 'd-2', sender: { id: 'me' } }),
  ]);
  assert.equal(useChatStore.getState().messagesByConversation['conv-1'].length, 0);
});
