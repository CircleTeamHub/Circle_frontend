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


// 分发器是服务端事件进 store 的唯一入口:它放行什么,store 里就有什么。
// 用真 protocol.ts(校验器) + store/通知 store 的桩,断言行为而非源码字符串。
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

function runModule(rel, requireImpl, extraContext = {}) {
  const context = {
    Date,
    Number,
    Array,
    Map,
    Set,
    Promise,
    setTimeout,
    clearTimeout,
    console: { warn: () => {} },
    module: { exports: {} },
    exports: {},
    require: requireImpl,
    ...extraContext,
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpile(rel), context);
  return context.module.exports;
}

/** socket.io 的极简替身:记下 handler,测试直接触发。 */
function fakeSocket() {
  const handlers = new Map();
  return {
    on: (event, handler) => handlers.set(event, handler),
    emit: (event, payload) => handlers.get(event)?.(payload),
  };
}

const deletedIds = new Set();

function loadDispatcher(storeOverrides = {}) {
  const state = {
    currentUserId: 'me',
    activeConversationId: null,
    conversations: [],
    ingested: [],
    banners: [],
    removed: [],
    alerts: [],
    revokes: [],
    deliveredReports: [],
    backfills: 0,
    ...storeOverrides,
  };
  // 补拉是 800ms 防抖的。测试里换成可控计时器:每条用例真等 0.8 秒既慢又脆,
  // 而这里要断言的恰恰是「补拉回来之后」发生了什么。
  let pendingBackfill = null;
  let lastBackfill = Promise.resolve();
  state.deferBackfill = false;
  state.settleBackfill = null;
  /** 只触发定时器、不等请求结束(补拉留在途中)。 */
  state.fireBackfill = () => {
    const fire = pendingBackfill;
    pendingBackfill = null;
    if (fire) fire();
  };
  /** 让在途的那次补拉以给定结果结束,并让微任务跑完。 */
  state.settle = async (outcome, value) => {
    const handle = state.settleBackfill;
    state.settleBackfill = null;
    if (!handle) return;
    handle[outcome](value);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  state.runBackfill = async () => {
    const fire = pendingBackfill;
    pendingBackfill = null;
    if (!fire) return;
    fire();
    await lastBackfill;
    // flushPendingBanners 挂在 loadChatConversations().then() 上,再让一拍微任务。
    await Promise.resolve();
    await Promise.resolve();
  };

  const storeState = {
    get currentUserId() {
      return state.currentUserId;
    },
    get activeConversationId() {
      return state.activeConversationId;
    },
    get conversations() {
      return state.conversations;
    },
    applyIncomingMessage: (message) =>
      state.conversations.some((c) => c.id === message.conversationId),
    ingestMessages: (conversationId, messages) => {
      for (const message of messages) state.ingested.push(message);
    },
    applyRead: () => {},
    applyPresence: () => {},
    removeConversation: (conversationId) => {
      state.removed.push(conversationId);
      state.conversations = state.conversations.filter(
        (c) => c.id !== conversationId,
      );
    },
    applyRevoke: (conversationId, messageId, revokedBy) => {
      state.revokes.push({ conversationId, messageId, revokedBy });
    },
    applyDelivered: () => {},
    applyReaction: () => {},
    applyEdit: () => {},
  };

  const dispatcher = runModule('src/chat-core/dispatcher.ts', (request) => {
    if (request === './protocol') {
      return runModule('src/chat-core/protocol.ts', () => {
        throw new Error('protocol should have no runtime deps');
      });
    }
    if (request === './store') return { useChatStore: { getState: () => storeState } };
    if (request === './api') {
      return {
        loadChatConversations: () => {
          state.backfills += 1;
          if (state.deferBackfill) {
            // 手动控制的在途请求:测并发补拉时要能让第一次「还没回来」。
            lastBackfill = new Promise((resolve, reject) => {
              state.settleBackfill = { resolve, reject };
            });
            // 未处理的 rejection 由被测代码的 .catch 接走,这里只暴露句柄。
            return lastBackfill;
          }
          lastBackfill = Promise.resolve(state.conversations);
          return lastBackfill;
        },
      };
    }
    if (request === './mappers') {
      return { getChatMessagePreview: (m) => String(m.content?.text ?? '[消息]') };
    }
    if (request === '@/services/api/utils') {
      // 白名单替身:只放行本站来源(与其它 chat 用例同款)。
      return {
        allowPeerMediaUrl: (u) =>
          typeof u === 'string' && u.startsWith('https://cdn.trusted/') ? u : null,
      };
    }
    if (request === './local-db') {
      return {
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
    }
    if (request === './deleted-messages') {
      // 本端删除的消息要在进横幅/补拉之前就被丢掉,所以分发器也依赖它。
      return {
        isMessageDeletedLocally: (id) => deletedIds.has(id),
      };
    }
    if (request === '@/features/notifications/store/use-notification-snackbar-store') {
      return {
        useNotificationSnackbarStore: {
          getState: () => ({
            enqueueChatMessage: (item) => state.banners.push(item),
          }),
        },
      };
    }
    if (request === './socket-manager') {
      return { reportChatDelivered: (cid, h) => state.deliveredReports.push({ cid, h }) };
    }
    if (request === 'react-native') {
      return { Alert: { alert: (text) => state.alerts.push(text) } };
    }
    if (request === '@/i18n') {
      return { default: { t: (key) => key }, t: (key) => key };
    }
    if (request === './local-db') return __localDbStub;
    throw new Error(`unexpected require: ${request}`);
  }, {
    setTimeout: (fn) => {
      pendingBackfill = fn;
      return 1;
    },
    clearTimeout: () => {
      pendingBackfill = null;
    },
  });

  const socket = fakeSocket();
  dispatcher.bindChatEvents(socket, () => true);
  return { socket, state, dispatcher };
}

function dto(overrides = {}) {
  return {
    id: 'm1',
    conversationId: 'c1',
    height: 3,
    type: 'text',
    content: { text: 'hi' },
    sender: { id: 'peer', nickname: '对方', avatarUrl: null },
    replyToId: null,
    d: null,
    createdAt: '2026-08-05T12:00:00.000Z',
    ...overrides,
  };
}

test('a well-formed chat:msg reaches the store', () => {
  const { socket, state } = loadDispatcher();
  socket.emit('chat:msg', dto());
  assert.equal(state.ingested.length, 1);
});

test('malformed payloads never reach the store', () => {
  const { socket, state } = loadDispatcher();
  const bad = [
    null,
    undefined,
    'not-an-object',
    [],
    dto({ id: '' }),
    dto({ conversationId: 42 }),
    dto({ type: '' }),
    // 这一条是最要命的:content=null 落库后,MessagesScreen 渲染时
    // getChatMessagePreview 读 content['text'] 抛异常 —— 已在分发器
    // try/catch 之外,消息页每次进都白屏,且它还落了库修不掉。
    dto({ content: null }),
    dto({ content: 'text' }),
    dto({ height: -1 }),
    dto({ height: 1.5 }),
    dto({ height: 'nope' }),
    dto({ createdAt: 'yesterday' }),
    dto({ createdAt: 123 }),
    dto({ sender: { nickname: '没有 id' } }),
    dto({ sender: 'peer' }),
    dto({ replyToId: 7 }),
    dto({ d: {} }),
  ];
  for (const payload of bad) {
    socket.emit('chat:msg', payload);
  }
  assert.equal(state.ingested.length, 0, 'a malformed payload was stored');
});

test('system messages with a null sender are still valid', () => {
  const { socket, state } = loadDispatcher();
  socket.emit('chat:msg', dto({ type: 'system', sender: null }));
  assert.equal(state.ingested.length, 1);
});

// 会话 id 是不透明 UUID —— 这个 fixture 以前写成 'direct:0000-a:ffff-b',
// 照着一个后端从不下发的形状编的,于是「陌生人第一条消息弹横幅」那条用例
// 走的是生产里永远走不到的分支,测过了但没有任何保护作用。
const DIRECT_ID = '3f2a1c4e-9b7d-4e21-8a55-6c0d1e2f3a4b';

function directConversation(overrides = {}) {
  return {
    id: DIRECT_ID,
    type: 'DIRECT',
    peer: { id: 'peer', nickname: '备注名', avatarUrl: 'https://cdn.trusted/p.png' },
    circleId: null,
    circle: null,
    ...overrides,
  };
}

test('the first message from a new contact banners once metadata lands', async () => {
  // 会话不在快照里(对方刚建的单聊 / 刚被拉进的群):标题、头像、跳转目标
  // 消息里一个都没有,只能等补拉。原来是从会话 id 的形状猜「这是不是 1:1」,
  // 猜中就拿发送者凑一条 —— 而会话 id 是 UUID,那条分支永远走不到,
  // 这两种情况实际上从来没有过横幅。
  const { socket, state } = loadDispatcher({ conversations: [] });
  socket.emit(
    'chat:msg',
    dto({
      conversationId: DIRECT_ID,
      sender: { id: 'peer', nickname: '新朋友', avatarUrl: 'https://cdn.trusted/p.png' },
    }),
  );

  // 元信息还没到,这一刻不弹(弹了就是拿发送者猜的)。
  assert.equal(state.banners.length, 0);

  // 补拉把会话带回来之后,攒着的那条才变成横幅。
  state.conversations = [directConversation()];
  await state.runBackfill();

  assert.equal(state.banners.length, 1);
  const banner = state.banners[0];
  assert.equal(banner.title, '备注名');
  assert.equal(banner.conversationType, 'private');
  // 跳转目标必须是对端 uuid,否则点开进不去。
  assert.equal(banner.sourceID, 'peer');
  assert.equal(banner.conversationID, DIRECT_ID);
});

test('a stranger group message also banners after backfill', async () => {
  // 群横幅要圈子名与圈子 id。这两样只有会话元信息里有 —— 等到了就该弹,
  // 而不是像原来那样直接 return(群会话永远没有横幅)。
  const { socket, state } = loadDispatcher({ conversations: [] });
  socket.emit('chat:msg', dto({ conversationId: 'grp-1' }));
  assert.equal(state.banners.length, 0);

  state.conversations = [
    {
      id: 'grp-1',
      type: 'GROUP',
      peer: null,
      circleId: 'circle-9',
      circle: { id: 'circle-9', name: '圈子名', avatarUrl: null },
    },
  ];
  await state.runBackfill();

  assert.equal(state.banners.length, 1);
  assert.equal(state.banners[0].title, '圈子名');
  assert.equal(state.banners[0].sourceID, 'circle-9');
  assert.equal(state.banners[0].conversationType, 'group');
});

test('only the newest message per conversation is banner-deferred', async () => {
  // 离线回来一次投递几十条:补拉后该弹一条「有新消息」,不是几十条横幅。
  const { socket, state } = loadDispatcher({ conversations: [] });
  for (let i = 0; i < 5; i += 1) {
    socket.emit(
      'chat:msg',
      dto({ id: `m${i}`, conversationId: DIRECT_ID, content: { text: `第${i}条` } }),
    );
  }

  state.conversations = [directConversation()];
  await state.runBackfill();

  assert.equal(state.banners.length, 1);
  assert.equal(state.banners[0].id, 'm4');
});

test('a conversation still missing after backfill is dropped, not re-queued', async () => {
  // 已退群 / 已删好友:元信息永远不会来了。攒着不放会一直占内存,
  // 而且之后每一次补拉都会把这条陈旧候选翻出来重试一遍。
  const { socket, state } = loadDispatcher({ conversations: [] });
  socket.emit('chat:msg', dto({ id: 'stale', conversationId: 'gone-1' }));
  await state.runBackfill();
  assert.equal(state.banners.length, 0);

  // 别的会话来消息 → 又排一次补拉。这时 'gone-1' 的元信息哪怕回来了,
  // 那条早就过去的消息也不该突然弹出来。
  state.conversations = [directConversation({ id: 'gone-1' })];
  socket.emit('chat:msg', dto({ id: 'fresh', conversationId: 'other-1' }));
  await state.runBackfill();

  assert.deepEqual(
    state.banners.map((b) => b.id),
    [],
  );
});

test('known conversations use their own metadata, not the sender\'s', () => {
  const { socket, state } = loadDispatcher({
    conversations: [directConversation()],
  });
  socket.emit(
    'chat:msg',
    dto({
      conversationId: DIRECT_ID,
      sender: { id: 'peer', nickname: '原始昵称', avatarUrl: null },
    }),
  );
  // 会话行上的名字(可能是本地备注)优先于消息里的昵称。
  assert.equal(state.banners[0].title, '备注名');
});

test('banner avatars go through the media allowlist', () => {
  const { socket, state } = loadDispatcher({
    conversations: [
      directConversation({
        peer: { id: 'peer', nickname: '备注名', avatarUrl: 'https://attacker/1.gif' },
      }),
    ],
  });
  socket.emit('chat:msg', dto({ conversationId: DIRECT_ID }));
  // 横幅一出现就会自动发起这次图片请求 —— 未授权来源必须落成占位。
  assert.equal(state.banners[0].avatarUrl, null);
});

test('self messages and the open conversation never raise a banner', () => {
  const { socket, state } = loadDispatcher({
    conversations: [directConversation()],
    activeConversationId: DIRECT_ID,
  });
  socket.emit('chat:msg', dto({ conversationId: DIRECT_ID }));
  assert.equal(state.banners.length, 0);

  const other = loadDispatcher({ conversations: [directConversation()] });
  other.socket.emit(
    'chat:msg',
    dto({
      conversationId: DIRECT_ID,
      sender: { id: 'me', nickname: '我', avatarUrl: null },
    }),
  );
  assert.equal(other.state.banners.length, 0);
});

test('a redelivered locally-deleted message never reaches the banner', () => {
  // applyIncomingMessage 对墓碑消息返回「已处理」,而横幅与补拉是无条件跑的 ——
  // 用户离开会话后,一条自己刚删掉的消息会以前台通知的形式重新弹出来。
  const { socket, state } = loadDispatcher();
  deletedIds.add('deleted-1');
  try {
    socket.emit('chat:msg', dto({ id: 'deleted-1' }));
    assert.equal(state.banners.length, 0);
    assert.equal(state.ingested.length, 0);
  } finally {
    deletedIds.delete('deleted-1');
  }
});

test('an older failed backfill does not discard newer banner candidates', async () => {
  // backfillTimer 在请求发出**之前**就置空了,所以第一次补拉在途时,另一个
  // 陌生会话来消息会再排一次补拉、并把候选加进同一个 map。原来第一次失败的
  // catch 会把整个 map 清掉 —— 第二次请求明明能拿到它的元信息,横幅却没了。
  const { socket, state } = loadDispatcher({ conversations: [] });
  state.deferBackfill = true;

  socket.emit('chat:msg', dto({ id: 'a', conversationId: 'conv-a' }));
  state.fireBackfill(); // 第一次补拉发出,挂在途中

  // 在途期间来了另一个陌生会话的消息 —— 它排的是第二次补拉。
  socket.emit('chat:msg', dto({ id: 'b', conversationId: 'conv-b' }));

  await state.settle('reject', new Error('network down'));
  assert.equal(state.banners.length, 0);

  // 第二次补拉把 conv-b 的元信息带回来了,它的横幅必须还在。
  state.deferBackfill = false;
  state.conversations = [directConversation({ id: 'conv-b' })];
  await state.runBackfill();

  assert.deepEqual(
    state.banners.map((b) => b.id),
    ['b'],
  );
});

test('a backfill only serves candidates that predate it', async () => {
  // 请求发出后才到的会话,元信息不可能在这一次的响应里。成功路径上把它
  // 一起 flush 掉的话,它会被当成「补拉后仍认不出」而直接丢弃。
  const { socket, state } = loadDispatcher({ conversations: [] });
  state.deferBackfill = true;

  socket.emit('chat:msg', dto({ id: 'early', conversationId: 'conv-early' }));
  state.fireBackfill();
  socket.emit('chat:msg', dto({ id: 'late', conversationId: 'conv-late' }));

  // 第一次补拉成功,但响应里只有 conv-early。
  state.conversations = [directConversation({ id: 'conv-early' })];
  await state.settle('resolve', state.conversations);
  assert.deepEqual(
    state.banners.map((b) => b.id),
    ['early'],
  );

  // conv-late 还留着,等第二次补拉。
  state.deferBackfill = false;
  state.conversations = [
    directConversation({ id: 'conv-early' }),
    directConversation({ id: 'conv-late' }),
  ];
  await state.runBackfill();
  assert.deepEqual(
    state.banners.map((b) => b.id),
    ['early', 'late'],
  );
});

test('a newer failed backfill does not steal the older one\'s candidate', async () => {
  // 完成顺序是任意的:后发的那次可能先失败。累积归属(arrivedAfter < 本次序号)下,
  // 第 2 次同时占有第 0、1 代候选,它的 catch 会顺手删掉第 1 次本来能服务的那条 ——
  // 元信息随后到了,横幅却已经没了。一个候选只能属于一次请求。
  const { socket, state } = loadDispatcher({ conversations: [] });
  state.deferBackfill = true;

  socket.emit('chat:msg', dto({ id: 'a', conversationId: 'conv-a' }));
  state.fireBackfill(); // 第 1 次发出,在途
  const first = state.settleBackfill;
  state.settleBackfill = null;

  socket.emit('chat:msg', dto({ id: 'b', conversationId: 'conv-b' }));
  state.fireBackfill(); // 第 2 次发出,也在途

  // 第 2 次先失败 —— 它只该丢掉自己那份(conv-b)。
  await state.settle('reject', new Error('network down'));

  // 第 1 次随后成功,conv-a 的元信息到了,它的横幅必须还在。
  state.conversations = [directConversation({ id: 'conv-a' })];
  first.resolve(state.conversations);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(
    state.banners.map((b) => b.id),
    ['a'],
  );
});

test('a payload without a sender never reaches the store', () => {
  // sender 可以是 null(系统消息 / 已注销用户),但**缺字段**是畸形载荷:
  // 判不出「这是不是我自己发的回声」,自己发的会被当成对方来的,
  // 多加一次未读、还弹一条前台横幅。
  const { socket, state } = loadDispatcher({
    conversations: [directConversation()],
  });
  const missing = dto({ conversationId: DIRECT_ID });
  delete missing.sender;
  socket.emit('chat:msg', missing);

  assert.equal(state.ingested.length, 0);
  assert.equal(state.banners.length, 0);

  // null 仍然放行 —— 否则注销用户发过的历史消息会被整条丢掉。
  socket.emit('chat:msg', dto({ conversationId: DIRECT_ID, sender: null }));
  assert.equal(state.ingested.length, 1);
});

// ---- chat:revoke(G-02):撤回广播 ----

test('chat:revoke routes to applyRevoke and drops malformed payloads', () => {
  const { socket, state } = loadDispatcher();
  socket.emit('chat:revoke', {
    conversationId: 'c1',
    messageId: 'm1',
    revokedBy: 'u2',
  });
  assert.deepEqual(state.revokes, [
    { conversationId: 'c1', messageId: 'm1', revokedBy: 'u2' },
  ]);

  socket.emit('chat:revoke', { conversationId: 'c1' });
  socket.emit('chat:revoke', null);
  assert.equal(state.revokes.length, 1);
});

// ---- chat:conversation(G-11/S-02):本人会话成员关系变化 ----

test('chat:conversation removed collapses the conversation and alerts only when active', () => {
  const { socket, state } = loadDispatcher();
  state.conversations = [{ id: 'c1', type: 'GROUP' }];
  state.activeConversationId = 'c1';

  socket.emit('chat:conversation', {
    kind: 'removed',
    conversationId: 'c1',
    userId: 'me',
  });

  assert.deepEqual(state.removed, ['c1']);
  // 正看着这个群才提示,文案走 im.conversation.removedFromGroup 词条。
  assert.deepEqual(state.alerts, ['im.conversation.removedFromGroup']);

  // 防复活:被移除会话的迟到广播既不入库也不触发补拉。
  socket.emit('chat:msg', dto({ conversationId: 'c1', id: 'late-1' }));
  assert.equal(state.ingested.length, 0);
});

test('chat:conversation left removes silently and joined lifts the guard', () => {
  const { socket, state } = loadDispatcher();
  state.conversations = [{ id: 'c1', type: 'GROUP' }];
  state.activeConversationId = null;

  socket.emit('chat:conversation', {
    kind: 'left',
    conversationId: 'c1',
    userId: 'me',
  });
  assert.deepEqual(state.removed, ['c1']);
  // left 是本人在别处的主动动作:静默收走,不弹提示。
  assert.deepEqual(state.alerts, []);

  // 重新入群:解除防复活标记,消息恢复入库。
  socket.emit('chat:conversation', {
    kind: 'joined',
    conversationId: 'c1',
    userId: 'me',
  });
  state.conversations = [{ id: 'c1', type: 'GROUP' }];
  socket.emit('chat:msg', dto({ conversationId: 'c1', id: 'back-1' }));
  assert.equal(state.ingested.length, 1);
});

test('a conversation restored by a snapshot lifts the removed guard (missed joined event)', () => {
  const { socket, state } = loadDispatcher();
  state.conversations = [{ id: 'c1', type: 'GROUP' }];
  socket.emit('chat:conversation', {
    kind: 'removed',
    conversationId: 'c1',
    userId: 'me',
  });
  assert.deepEqual(state.removed, ['c1']);

  // 离线期间被重新拉回群,joined 事件错过了;重连 resync 把会话快照带回列表。
  // 防复活标记必须自愈解除,否则实时消息被静默丢弃、只有翻历史才看得到。
  state.conversations = [{ id: 'c1', type: 'GROUP' }];
  socket.emit('chat:msg', dto({ conversationId: 'c1', id: 'after-rejoin' }));
  assert.equal(state.ingested.length, 1);
});

test('chat:conversation for another user or malformed payloads is ignored', () => {
  const { socket, state } = loadDispatcher();
  state.conversations = [{ id: 'c1', type: 'GROUP' }];

  socket.emit('chat:conversation', {
    kind: 'removed',
    conversationId: 'c1',
    userId: 'someone-else',
  });
  socket.emit('chat:conversation', {
    kind: 'evicted',
    conversationId: 'c1',
    userId: 'me',
  });
  socket.emit('chat:conversation', { kind: 'removed', userId: 'me' });

  assert.deepEqual(state.removed, []);
  assert.deepEqual(state.alerts, []);
});
