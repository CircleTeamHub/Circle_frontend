const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

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


// 会话列表侧的 store 行为 + mapper:与 chat-core-store.test.js 同款 vm harness。
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

function loadStore() {
  const context = {
    module: { exports: {} },
    exports: {},
    Date,
    // 自毁清理会排下一次到期的定时器。上下文里没有 timers 会在用例结束后炸成
    // unhandledRejection（断言全绿、文件整体红）；给真 timers 又会把事件循环
    // 吊住让整个文件跑不完（store 里那个 timer 没 unref）。这组用例不验证排期，
    // 给一对空实现即可。
    setTimeout: () => 0,
    clearTimeout: () => {},
    require: (request) => {
      if (request === 'zustand') return zustandStub();
      if (request === './protocol') return {};
      // 本地删除墓碑在这组用例里始终为空(删除行为由 chat-core-store 覆盖)。
      if (request === './local-db') {
      return {
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
    }
      if (request === './deleted-messages') {
        return {
          isMessageDeletedLocally: () => false,
          markMessageDeletedLocally: () => {},
        };
      }
      if (request === '@/storage') {
        return { storage: { set: () => {}, getString: () => undefined } };
      }
      if (request === './local-db') return __localDbStub;
    if (request === './burn-durations') return loadBurnDurations();
      throw new Error(`unexpected require: ${request}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpile('src/chat-core/store.ts'), context);
  return context.module.exports;
}

function loadMappers() {
  const context = {
    module: { exports: {} },
    exports: {},
    Date,
    require: (request) => {
      if (request === '@/i18n') {
        return {
          default: {
            language: 'zh',
            t: (key) => (key === 'tempChats.title' ? '临时群聊' : key),
          },
        };
      }
      if (request === '@/services/api/utils') {
        return { normalizeMediaUrl: (value) => value };
      }
      if (request === '@/utils/locale') {
        return { getLocalizedDateTimeLocale: () => 'zh-CN' };
      }
      if (request === '@/types' || request === './protocol') return {};
      if (request === './burn-durations') return loadBurnDurations();
      throw new Error(`unexpected require: ${request}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpile('src/chat-core/mappers.ts'), context);
  return context.module.exports;
}

function conv(overrides = {}) {
  return {
    id: overrides.id ?? 'conv-1',
    type: 'DIRECT',
    peer: { id: 'u2', nickname: '对方', avatarUrl: null },
    circleId: null,
    circle: null,
    tempChat: null,
    lastMessage: null,
    unreadCount: 0,
    pinned: false,
    muted: false,
    lastMessageAt: null,
    ...overrides,
  };
}

function msg(overrides = {}) {
  return {
    id: overrides.id ?? 'm1',
    conversationId: 'conv-1',
    height: 1,
    type: 'text',
    content: { text: 'hi' },
    sender: { id: 'u2', nickname: '对方', avatarUrl: null },
    replyToId: null,
    d: null,
    createdAt: '2026-08-05T12:00:00.000Z',
    ...overrides,
  };
}

test('conversations sort pinned-first then lastMessageAt desc', () => {
  const { useChatStore } = loadStore();
  const store = useChatStore.getState();
  store.setConversations([
    conv({ id: 'old', lastMessageAt: '2026-08-01T00:00:00.000Z' }),
    conv({ id: 'pinned-old', pinned: true, lastMessageAt: '2026-07-01T00:00:00.000Z' }),
    conv({ id: 'new', lastMessageAt: '2026-08-05T00:00:00.000Z' }),
  ]);
  assert.deepEqual(
    Array.from(useChatStore.getState().conversations, (c) => c.id),
    ['pinned-old', 'new', 'old'],
  );
});

test('incoming message bumps preview, unread and resorts', () => {
  const { useChatStore } = loadStore();
  const store = useChatStore.getState();
  store.setCurrentUserId('u1');
  store.setConversations([
    conv({ id: 'conv-2', lastMessageAt: '2026-08-05T00:00:00.000Z' }),
    conv({ id: 'conv-1', lastMessageAt: '2026-08-01T00:00:00.000Z', unreadCount: 1 }),
  ]);

  store.applyIncomingMessage(msg({ createdAt: '2026-08-06T00:00:00.000Z' }));

  const [first] = useChatStore.getState().conversations;
  assert.equal(first.id, 'conv-1');
  assert.equal(first.unreadCount, 2);
  assert.equal(first.lastMessage.id, 'm1');
});

test('own messages and active-conversation messages do not count unread', () => {
  const { useChatStore } = loadStore();
  const store = useChatStore.getState();
  store.setCurrentUserId('u1');
  store.setConversations([conv()]);

  // 自己发的
  store.applyIncomingMessage(
    msg({ sender: { id: 'u1', nickname: '我', avatarUrl: null } }),
  );
  assert.equal(useChatStore.getState().conversations[0].unreadCount, 0);

  // 正在看的会话
  store.setActiveConversationId('conv-1');
  store.applyIncomingMessage(msg({ id: 'm2' }));
  assert.equal(useChatStore.getState().conversations[0].unreadCount, 0);

  // 不在看 + 他人消息
  store.setActiveConversationId(null);
  store.applyIncomingMessage(msg({ id: 'm3' }));
  assert.equal(useChatStore.getState().conversations[0].unreadCount, 1);
});

test('markConversationReadLocal zeroes unread without touching others', () => {
  const { useChatStore } = loadStore();
  const store = useChatStore.getState();
  store.setConversations([
    conv({ id: 'a', unreadCount: 3 }),
    conv({ id: 'b', unreadCount: 5 }),
  ]);
  store.markConversationReadLocal('a');
  const byId = new Map(
    useChatStore.getState().conversations.map((c) => [c.id, c.unreadCount]),
  );
  assert.equal(byId.get('a'), 0);
  assert.equal(byId.get('b'), 5);
});

test('selectTotalUnread excludes muted conversations', () => {
  const { selectTotalUnread } = loadStore();
  const total = selectTotalUnread({
    conversations: [
      conv({ id: 'a', unreadCount: 3 }),
      conv({ id: 'b', unreadCount: 5, muted: true }),
      conv({ id: 'c', unreadCount: 2 }),
    ],
  });
  assert.equal(total, 5);
});

test('conversation mapper renders group identity from circle info', () => {
  // mapper 依赖 i18n/locale/工具,直接做源码级断言(与 realtime 测试同风格)。
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/chat-core/mappers.ts'),
    'utf8',
  );
  assert.match(source, /dto\.circle\?\.name/);
  assert.match(source, /dto\.peer\?\.nickname/);
  assert.match(source, /normalizeMediaUrl/);
  assert.match(source, /im\.preview\./);
  // DIRECT 的 sourceID 必须是对端 userID(个人资料跳转依赖)。
  assert.match(source, /dto\.peer\?\.id/);
});

test('TEMP conversation keeps its room title when the latest sender is self', () => {
  const { mapChatConversationToUI } = loadMappers();
  const ui = mapChatConversationToUI(
    conv({
      id: 'conv-temp',
      type: 'TEMP',
      peer: null,
      tempChat: { id: 'tc-1', title: 'Kk' },
      lastMessage: msg({
        conversationId: 'conv-temp',
        sender: { id: 'me', nickname: '我自己', avatarUrl: 'https://me/avatar.png' },
      }),
    }),
  );

  assert.equal(ui.name, 'Kk');
  assert.equal(ui.avatarUrl, undefined);
  assert.equal(ui.sourceID, 'conv-temp');
  assert.equal(ui.conversationType, 'group');
  assert.equal(ui.isTempChat, true);
});

test('TEMP conversation never falls back to the latest sender on an old backend', () => {
  const { mapChatConversationToUI } = loadMappers();
  const ui = mapChatConversationToUI(
    conv({
      type: 'TEMP',
      peer: null,
      tempChat: undefined,
      lastMessage: msg({ sender: { id: 'me', nickname: '我自己', avatarUrl: null } }),
    }),
  );

  assert.equal(ui.name, '临时群聊');
});

// —— 自毁策略:开启时间与 duration 同等重要（Codex P1 两条） ——

test('a remote refresh that only moves the start time still counts as a policy change', () => {
  const { useChatStore } = loadStore();
  const store = useChatStore.getState();
  store.setCurrentUserId('u1');
  store.setViewerSelfDestructSec(300, undefined, '2026-08-01T00:00:00.000Z');
  const baseline = useChatStore.getState().selfDestructPolicyEpoch;

  // 同一档位、只有开启时间变了。之前只比 duration,于是 epoch 不动、清理也不跑,
  // 而新的开启时间恰恰改变了「哪些缓存消息已到期、下一次清理几点跑」。
  store.setViewerSelfDestructSec(300, { remoteRefresh: true }, '2026-08-09T00:00:00.000Z');

  const next = useChatStore.getState();
  assert.equal(next.viewerSelfDestructStartedAt, '2026-08-09T00:00:00.000Z');
  assert.ok(
    next.selfDestructPolicyEpoch > baseline,
    '开启时间变化必须推进 selfDestructPolicyEpoch',
  );
});

test('a remote refresh with the same duration and same start time stays a no-op', () => {
  const { useChatStore } = loadStore();
  const store = useChatStore.getState();
  store.setCurrentUserId('u1');
  store.setViewerSelfDestructSec(300, undefined, '2026-08-01T00:00:00.000Z');
  const baseline = useChatStore.getState().selfDestructPolicyEpoch;

  store.setViewerSelfDestructSec(300, { remoteRefresh: true }, '2026-08-01T00:00:00.000Z');

  assert.equal(useChatStore.getState().selfDestructPolicyEpoch, baseline);
});

test('an old backend response without burnStartedAt still gets a start boundary', () => {
  const { useChatStore } = loadStore();
  const store = useChatStore.getState();
  store.setConversations([conv({ id: 'conv-1' })]);

  // 旧服务端只回 burnDurationSec。不兜底的话开启时间是 null,而过期判定要求它
  // 有限 —— 界面显示「已开启」,消息却永不焚毁,且没有任何报错。
  store.applyBurnDuration('conv-1', 300, undefined);

  const [updated] = useChatStore.getState().conversations;
  assert.equal(updated.burnDurationSec, 300);
  assert.ok(
    Number.isFinite(Date.parse(updated.burnStartedAt)),
    '缺失的开启时间要兜底成一个可解析的时刻',
  );
});

test('a disable response clears the start boundary instead of inventing one', () => {
  const { useChatStore } = loadStore();
  const store = useChatStore.getState();
  store.setConversations([
    conv({ id: 'conv-1', burnDurationSec: 300, burnStartedAt: '2026-08-01T00:00:00.000Z' }),
  ]);

  store.applyBurnDuration('conv-1', 0, undefined);

  const [updated] = useChatStore.getState().conversations;
  assert.equal(updated.burnStartedAt, null);
});
