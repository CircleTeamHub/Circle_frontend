const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { withChatCoreStubs } = require('./helpers/chat-core-stubs');

// 焚毁档位表(burn-durations.ts)只依赖 i18n —— 这里加载**真实实现**而不是桩:
// 档位白名单是 setViewerSelfDestructSec 的唯一闸门,用假的等于没测。
let __burnDurationsSource = null;
function loadBurnDurations(translate = (key) => key) {
  if (!__burnDurationsSource) {
    const filePath = path.join(process.cwd(), 'src/chat-core/burn-durations.ts');
    __burnDurationsSource = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
      fileName: filePath,
    }).outputText;
  }
  const ctx = {
    module: { exports: {} },
    exports: {},
    require: (request) => {
      if (request === '@/i18n') {
        return { __esModule: true, default: { t: translate, language: 'zh' } };
      }
      throw new Error(`unexpected require: ${request}`);
    },
  };
  ctx.exports = ctx.module.exports;
  vm.runInNewContext(__burnDurationsSource, ctx);
  return ctx.module.exports;
}

/**
 * 媒体重发的并发合流(codex review)。
 *
 * 失败气泡长按「重发」会重跑整条「presign + 上传 + 发送」。重发期间气泡原样
 * 红着、mediaRetries 里的闭包也还在 —— 用户多按几下就是多跑几遍上传:重复
 * 拿签名、把同一份原图和缩略图再传一遍,存储上留下没人引用的对象。复用同一个
 * deliveryId 只能让最后那条聊天消息不重复,拦不住上传本身。
 */

const __localDbStub = {
  persistLocalConversations: async () => {},
  upsertLocalConversation: async () => {},
  removeLocalConversation: async () => {},
  persistLocalMessages: async () => {},
  deleteLocalMessage: async () => {},
  purgeExpiredLocalMessages: async () => {},
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

function runModule(rel, requireImpl, extraGlobals = {}) {
  const context = {
    Date,
    Math,
    Number,
    module: { exports: {} },
    exports: {},
    require: withChatCoreStubs(requireImpl),
    ...extraGlobals,
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpile(rel), context);
  return context.module.exports;
}

function zustandStub() {
  const makeStore = (initializer) => {
    const state = {};
    const set = (partial) => {
      const next = typeof partial === 'function' ? partial(state) : partial;
      Object.assign(state, next);
    };
    Object.assign(state, initializer(set, () => state));
    return { getState: () => state, setState: set };
  };
  return {
    create: (initializer) =>
      initializer === undefined ? makeStore : makeStore(initializer),
  };
}

class ChatSendError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = 'ChatSendError';
    this.code = code;
  }
}

function loadStack({
  onSend = async () => ({ messageId: 'srv-1', height: 9 }),
  localDb = {},
  pendingMedia = {},
} = {}) {
  const localDbStub = { ...__localDbStub, ...localDb };
  const pendingMediaStub = {
    persistPendingMediaFile: async () => null,
    resolvePendingMediaUri: async () => null,
    deletePendingMedia: async () => {},
    ...pendingMedia,
  };
  const store = runModule('src/chat-core/store.ts', (request) => {
    if (request === 'zustand') return zustandStub();
    if (request === './protocol')
      return runModule('src/chat-core/protocol.ts', () => {
        throw new Error('protocol should have no runtime deps');
      });
    if (request === './local-db') return localDbStub;
    if (request === './pending-media') return pendingMediaStub;
    if (request === './deleted-messages') {
      return {
        isMessageDeletedLocally: () => false,
        markMessageDeletedLocally: () => {},
      };
    }
    if (request === '@/storage') {
      return { storage: { set: () => {}, getString: () => undefined } };
    }
    if (request === './burn-durations') return loadBurnDurations();
      throw new Error(`unexpected require: ${request}`);
  });

  const client = runModule('src/chat-core/client.ts', (request) => {
    if (request === '@/services/api/credit-policy')
      return { assertLocalCanSendMessage: () => {} };
    if (request === '@/stores/authStore') {
      return {
        useAuthStore: {
          getState: () => ({
            user: { id: 'me', nickname: '我', avatarUrl: null },
            sessionEpoch: 1,
          }),
        },
      };
    }
    if (request === './api') {
      return {
        createCircleChatConversation: async () => ({ id: 'c1' }),
        createDirectChatConversation: async () => ({ id: 'c1' }),
        loadChatHistory: async () => ({ messages: [], nextBeforeHeight: null }),
      };
    }
    if (request === './send-errors') return { reportChatSendFailure: () => {} };
    if (request === './socket-manager') {
      return {
        ChatSendError,
        createDeliveryId: () => 'd-test',
        markConversationRead: () => {},
        sendChatMessage: onSend,
      };
    }
    if (request === './store') return store;
    if (request === './protocol')
      return runModule('src/chat-core/protocol.ts', () => {
        throw new Error('protocol should have no runtime deps');
      });
    if (request === './local-db') return localDbStub;
    if (request === './pending-media') return pendingMediaStub;
    if (request === './burn-durations') return loadBurnDurations();
      throw new Error(`unexpected require: ${request}`);
  });

  const state = store.useChatStore.getState();
  state.setCurrentUserId('me');
  state.setConversations([
    {
      id: 'c1',
      type: 'DIRECT',
      peer: { id: 'peer', nickname: '对方', avatarUrl: null },
      circleId: null,
      circle: null,
      lastMessage: null,
      unreadCount: 0,
      pinned: false,
      muted: false,
      lastMessageAt: null,
    },
  ]);
  return { client, store };
}

const bubble = (store, d) =>
  (store.useChatStore.getState().messagesByConversation['c1'] ?? []).find(
    (m) => m.d === d,
  );

test('并发重发只跑一次上传', async () => {
  const { client, store } = loadStack();
  let uploads = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const d = client.startMediaSend({
    conversationId: 'c1',
    type: 'image',
    localContent: { localUri: 'file:///a.jpg' },
    retry: async () => {
      uploads += 1;
      await gate;
    },
  });
  client.failMediaSend('c1', d);
  assert.equal(bubble(store, d).failed, true);

  // 用户连按三下「重发」——上传只该跑一遍。
  const attempts = [
    client.retryFailedChatMessage('c1', d),
    client.retryFailedChatMessage('c1', d),
    client.retryFailedChatMessage('c1', d),
  ];
  assert.equal(uploads, 1);

  release();
  await Promise.all(attempts);

  // 重发跑完后锁要放开,否则这条气泡再也重发不了。
  const again = client.retryFailedChatMessage('c1', d);
  assert.equal(uploads, 2);
  await again;
});

test('重发期间气泡回到「发送中」,重发菜单项随之消失', async () => {
  const { client, store } = loadStack();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const d = client.startMediaSend({
    conversationId: 'c1',
    type: 'voice',
    localContent: { localUri: 'file:///a.m4a', duration: 3 },
    retry: async () => {
      await gate;
    },
  });
  client.failMediaSend('c1', d);

  const attempt = client.retryFailedChatMessage('c1', d);
  // sendStatus 由 height/failed 推导(message-mappers):failed 清掉即回到「发送中」,
  // 长按菜单里的「重发」只在 sendStatus===3 时出现 —— 连点的入口本身就没了。
  assert.equal(bubble(store, d).failed, undefined);

  release();
  await attempt;
});

test('重发再次失败 → 气泡重新标红,还能再发', async () => {
  const { client, store } = loadStack();
  let uploads = 0;

  const d = client.startMediaSend({
    conversationId: 'c1',
    type: 'image',
    localContent: { localUri: 'file:///a.jpg' },
    // 上传路径自己 catch 后调 failMediaSend(不抛),照真实调用方的形状写。
    retry: async (deliveryId) => {
      uploads += 1;
      client.failMediaSend('c1', deliveryId);
    },
  });
  client.failMediaSend('c1', d);

  await client.retryFailedChatMessage('c1', d);
  assert.equal(uploads, 1);
  assert.equal(bubble(store, d).failed, true);

  await client.retryFailedChatMessage('c1', d);
  assert.equal(uploads, 2);
  assert.equal(bubble(store, d).failed, true);
});

// ---- App 被杀后的待发媒体(持久副本 + outbox,见 chat-core/pending-media) ----

const settle = async () => {
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

test('a picked file is recorded in the outbox before the keyed send, and cleaned up once it is delivered', async () => {
  const upserts = [];
  const deletedRows = [];
  const deletedCopies = [];
  let finishCopy;
  const { client } = loadStack({
    localDb: {
      outboxUpsert: async (entry) => {
        upserts.push(JSON.parse(JSON.stringify(entry)));
      },
      outboxDelete: async (d) => {
        deletedRows.push(d);
      },
    },
    pendingMedia: {
      // 拷贝慢(大视频、安卓真拷):上传先跑完也得排在它后面写 outbox。
      persistPendingMediaFile: () =>
        new Promise((resolve) => {
          finishCopy = () => resolve('media.jpg');
        }),
      deletePendingMedia: async (userId, d) => {
        deletedCopies.push([userId, d]);
      },
    },
  });

  const d = client.startMediaSend({
    conversationId: 'c1',
    type: 'image',
    localContent: { localUri: 'file:///cache/a.jpg', width: 800, height: 600 },
    retry: async () => {},
    source: { uri: 'file:///cache/a.jpg', uploadName: 'IMG_1.jpg', contentType: 'image/jpeg' },
  });
  const sent = client.sendImageMessage({
    conversationId: 'c1',
    key: 'chat/me/a.jpg',
    localUri: 'file:///cache/a.jpg',
    width: 800,
    height: 600,
    deliveryId: d,
  });
  await settle();
  assert.deepEqual(upserts, [], '副本还没落盘时不能先写带 key 的那一行');

  finishCopy();
  await sent;
  await settle();

  assert.equal(upserts.length, 2);
  // 第一行:上传没完成时重启也能从副本重发。
  assert.deepEqual(upserts[0].payload.content, {});
  assert.deepEqual(upserts[0].payload.pendingMedia, {
    type: 'image',
    fileName: 'media.jpg',
    uploadName: 'IMG_1.jpg',
    contentType: 'image/jpeg',
    width: 800,
    height: 600,
  });
  // 第二行:有 key 了,副本记录仍然带着(冷启动靠它找回本地预览)。
  assert.equal(upserts[1].payload.content.key, 'chat/me/a.jpg');
  assert.equal(upserts[1].payload.pendingMedia.fileName, 'media.jpg');
  // 发出去了:outbox 出队、副本删掉。
  assert.deepEqual(deletedRows, [d]);
  assert.deepEqual(deletedCopies, [['me', d]]);
});

test('deleting the bubble while its copy is still being written does not resurrect it after a restart', async () => {
  const upserts = [];
  const deletedCopies = [];
  let finishCopy;
  const { client, store } = loadStack({
    localDb: {
      outboxUpsert: async (entry) => {
        upserts.push(entry);
      },
    },
    pendingMedia: {
      persistPendingMediaFile: () =>
        new Promise((resolve) => {
          finishCopy = () => resolve('media.m4a');
        }),
      deletePendingMedia: async (userId, d) => {
        deletedCopies.push([userId, d]);
      },
    },
  });

  const d = client.startMediaSend({
    conversationId: 'c1',
    type: 'voice',
    localContent: { localUri: 'file:///cache/a.m4a', duration: 3 },
    retry: async () => {},
    source: { uri: 'file:///cache/a.m4a', uploadName: 'a.m4a', contentType: 'audio/mp4' },
  });
  client.failMediaSend('c1', d);
  store.useChatStore.getState().removeMessage('c1', `local:${d}`);

  finishCopy();
  await settle();

  assert.deepEqual(upserts, [], '删掉的消息不能再写回 outbox');
  assert.ok(deletedCopies.some(([, id]) => id === d), '副本也要删');
});

test('after a restart an upload that never finished is re-run from the durable copy', async () => {
  const reuploads = [];
  const { client } = loadStack({
    localDb: {
      outboxList: async () => [
        {
          d: 'd-photo',
          conversationId: 'c1',
          payload: {
            conversationId: 'c1',
            type: 'image',
            content: {},
            d: 'd-photo',
            pendingMedia: {
              type: 'image',
              fileName: 'media.jpg',
              uploadName: 'IMG_1.jpg',
              contentType: 'image/jpeg',
              width: 800,
            },
          },
          createdAt: new Date().toISOString(),
        },
      ],
    },
    pendingMedia: {
      resolvePendingMediaUri: async (userId, d, fileName) =>
        `file:///docs/chat-outbox/${userId}/${d}/${fileName}`,
    },
  });

  await client.retryFailedChatMessage('c1', 'd-photo', {
    reuploadMedia: async (upload) => {
      reuploads.push(JSON.parse(JSON.stringify(upload)));
    },
  });

  assert.deepEqual(reuploads, [
    {
      conversationId: 'c1',
      deliveryId: 'd-photo',
      record: {
        type: 'image',
        fileName: 'media.jpg',
        uploadName: 'IMG_1.jpg',
        contentType: 'image/jpeg',
        width: 800,
      },
      uri: 'file:///docs/chat-outbox/me/d-photo/media.jpg',
    },
  ]);
});

test('a restart retry whose copy is gone fails with a reason instead of an endless retry', async () => {
  const { client, store } = loadStack({
    localDb: {
      outboxList: async () => [
        {
          d: 'd-gone',
          conversationId: 'c1',
          payload: {
            conversationId: 'c1',
            type: 'voice',
            content: {},
            d: 'd-gone',
            pendingMedia: {
              type: 'voice',
              fileName: 'media.m4a',
              uploadName: 'a.m4a',
              contentType: 'audio/mp4',
              duration: 3,
            },
          },
          createdAt: new Date().toISOString(),
        },
      ],
    },
  });
  store.useChatStore.getState().ingestMessages('c1', [
    {
      id: 'outbox-d-gone',
      conversationId: 'c1',
      height: 0,
      type: 'voice',
      content: { duration: 3 },
      sender: { id: 'me', nickname: '', avatarUrl: null },
      replyToId: null,
      d: 'd-gone',
      createdAt: new Date().toISOString(),
    },
  ]);

  await assert.rejects(
    client.retryFailedChatMessage('c1', 'd-gone', { reuploadMedia: async () => {} }),
    (error) => error.code === 'CHAT_MEDIA_SOURCE_MISSING',
  );
  assert.equal(bubble(store, 'd-gone').failed, true);
});

test('an uploaded media message resends its keyed payload without the local-only fields', async () => {
  const sent = [];
  const deletedCopies = [];
  const { client } = loadStack({
    onSend: async (payload) => {
      sent.push(JSON.parse(JSON.stringify(payload)));
      return { messageId: 'srv-9', height: 12 };
    },
    localDb: {
      outboxList: async () => [
        {
          d: 'd-keyed',
          conversationId: 'c1',
          payload: {
            conversationId: 'c1',
            type: 'video',
            content: { key: 'chat/me/v.mp4', duration: 8 },
            d: 'd-keyed',
            pendingMedia: {
              type: 'video',
              fileName: 'media.mp4',
              uploadName: 'v.mp4',
              contentType: 'video/mp4',
              duration: 8,
            },
          },
          createdAt: new Date().toISOString(),
        },
      ],
    },
    pendingMedia: {
      deletePendingMedia: async (userId, d) => {
        deletedCopies.push([userId, d]);
      },
    },
  });

  let reuploaded = false;
  await client.retryFailedChatMessage('c1', 'd-keyed', {
    reuploadMedia: async () => {
      reuploaded = true;
    },
  });
  await settle();

  // 对象已经在存储里了:不重新上传,把同一份载荷再发一次(服务端按 d 幂等)。
  assert.equal(reuploaded, false);
  assert.deepEqual(sent, [
    {
      conversationId: 'c1',
      type: 'video',
      content: { key: 'chat/me/v.mp4', duration: 8 },
      d: 'd-keyed',
    },
  ]);
  assert.deepEqual(deletedCopies, [['me', 'd-keyed']]);
});
