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
  return {
    create: (initializer) => {
      const state = {};
      const set = (partial) => {
        const next = typeof partial === 'function' ? partial(state) : partial;
        Object.assign(state, next);
      };
      const get = () => state;
      Object.assign(state, initializer(set, get));
      return { getState: get, setState: set };
    },
  };
}

function loadChatStore() {
  const context = {
    module: { exports: {} },
    exports: {},
    require: (request) => {
      if (request === 'zustand') return zustandStub();
      if (request === './protocol') {
        // protocol.ts 零依赖,直接同环境执行。
        const sub = {
          module: { exports: {} },
          exports: {},
          require: () => {
            throw new Error('protocol should have no runtime deps');
          },
        };
        sub.exports = sub.module.exports;
        vm.runInNewContext(transpile('src/chat-core/protocol.ts'), sub);
        return sub.module.exports;
      }
      throw new Error(`unexpected require: ${request}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpile('src/chat-core/store.ts'), context);
  return context.module.exports;
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
