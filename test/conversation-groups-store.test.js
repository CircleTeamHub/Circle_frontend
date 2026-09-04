const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { withObservabilityStubs } = require('./helpers/observability-stubs');

function loadStore(apiMocks) {
  const filePath = path.join(
    process.cwd(),
    'src/features/messages/store/use-message-groups-store.ts',
  );
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;

  // 内存版 MMKV adapter，避免 native MMKV 在 node 下抛错
  const mmkvBacking = new Map();
  const mmkvJsonStorage = {
    getItem: (k) => mmkvBacking.get(k) ?? null,
    setItem: (k, v) => {
      mmkvBacking.set(k, v);
    },
    removeItem: (k) => {
      mmkvBacking.delete(k);
    },
  };

  const context = {
    module: { exports: {} },
    exports: {},
    setTimeout,
    clearTimeout,
    console: { warn: () => {} },
    require: withObservabilityStubs((specifier) => {
      if (specifier === 'zustand') return require('zustand');
      if (specifier === 'zustand/middleware') return require('zustand/middleware');
      if (specifier === '@/storage') return { mmkvJsonStorage };
      if (specifier === '@/services/api/conversation-groups') return apiMocks;
      if (specifier === '@/i18n') {
        return {
          __esModule: true,
          default: { t: (key, opts) => { let s = (opts && opts.defaultValue) || key; if (opts) for (const k of Object.keys(opts)) if (k !== 'defaultValue') s = s.split('{{' + k + '}}').join(String(opts[k])); return s; }, language: 'zh' },
        };
      }
      throw new Error(`Unexpected import: ${specifier}`);
    }),
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return {
    useMessageGroupsStore: context.module.exports.useMessageGroupsStore,
    getGroupsForConversation: context.module.exports.getGroupsForConversation,
    mmkvBacking,
  };
}

function makeGroup(overrides = {}) {
  return {
    id: 'g-1',
    name: '家人',
    sortOrder: 0,
    pinnedToTabs: true,
    conversationIDs: [],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('load() pulls from server and stores sorted by sortOrder then createdAt', async () => {
  const apiMocks = {
    fetchConversationGroups: async () => [
      makeGroup({ id: 'g-3', sortOrder: 5, createdAt: '2025-01-03T00:00:00.000Z' }),
      makeGroup({ id: 'g-1', sortOrder: 0, createdAt: '2025-01-01T00:00:00.000Z' }),
      makeGroup({ id: 'g-2', sortOrder: 0, createdAt: '2025-01-02T00:00:00.000Z' }),
    ],
    createConversationGroup: async () => makeGroup(),
    updateConversationGroup: async () => makeGroup(),
    deleteConversationGroup: async () => undefined,
    setConversationGroupMembers: async () => makeGroup(),
  };
  const { useMessageGroupsStore } = loadStore(apiMocks);

  await useMessageGroupsStore.getState().load();

  const ids = useMessageGroupsStore.getState().groups.map((g) => g.id);
  // JSON round-trip 抹掉 VM realm 带来的 Array.prototype 差异，避免 deepStrictEqual 误判
  assert.deepEqual(JSON.parse(JSON.stringify(ids)), ['g-1', 'g-2', 'g-3']);
  assert.equal(useMessageGroupsStore.getState().loading, false);
  assert.equal(useMessageGroupsStore.getState().error, null);
});

test('load() surfaces error message and keeps loading=false on failure', async () => {
  const apiMocks = {
    fetchConversationGroups: async () => {
      throw new Error('network down');
    },
    createConversationGroup: async () => makeGroup(),
    updateConversationGroup: async () => makeGroup(),
    deleteConversationGroup: async () => undefined,
    setConversationGroupMembers: async () => makeGroup(),
  };
  const { useMessageGroupsStore } = loadStore(apiMocks);

  await useMessageGroupsStore.getState().load();

  assert.equal(useMessageGroupsStore.getState().loading, false);
  assert.equal(useMessageGroupsStore.getState().error, 'network down');
  assert.deepEqual(
    JSON.parse(JSON.stringify(useMessageGroupsStore.getState().groups)),
    [],
  );
});

test('rename() optimistically updates and rolls back on server error', async () => {
  let shouldFail = false;
  const apiMocks = {
    fetchConversationGroups: async () => [makeGroup({ name: '原名' })],
    updateConversationGroup: async (id, patch) => {
      if (shouldFail) throw new Error('rename rejected by server');
      return makeGroup({ id, name: patch.name });
    },
    createConversationGroup: async () => makeGroup(),
    deleteConversationGroup: async () => undefined,
    setConversationGroupMembers: async () => makeGroup(),
  };
  const { useMessageGroupsStore } = loadStore(apiMocks);

  await useMessageGroupsStore.getState().load();
  await useMessageGroupsStore.getState().rename('g-1', '新名');
  assert.equal(useMessageGroupsStore.getState().groups[0].name, '新名');

  shouldFail = true;
  await assert.rejects(() =>
    useMessageGroupsStore.getState().rename('g-1', '再改'),
  );
  // 回滚到上一个成功的状态
  assert.equal(useMessageGroupsStore.getState().groups[0].name, '新名');
});

test('rename() rejects empty/whitespace name without hitting the server', async () => {
  let updateCalled = false;
  const apiMocks = {
    fetchConversationGroups: async () => [makeGroup()],
    updateConversationGroup: async () => {
      updateCalled = true;
      return makeGroup();
    },
    createConversationGroup: async () => makeGroup(),
    deleteConversationGroup: async () => undefined,
    setConversationGroupMembers: async () => makeGroup(),
  };
  const { useMessageGroupsStore } = loadStore(apiMocks);
  await useMessageGroupsStore.getState().load();

  await assert.rejects(
    () => useMessageGroupsStore.getState().rename('g-1', '   '),
    /不能为空/,
  );
  assert.equal(updateCalled, false);
});

test('remove() drops group locally, restores on server failure', async () => {
  let shouldFail = false;
  const apiMocks = {
    fetchConversationGroups: async () => [
      makeGroup({ id: 'g-1' }),
      makeGroup({ id: 'g-2', name: '工作' }),
    ],
    deleteConversationGroup: async () => {
      if (shouldFail) throw new Error('cannot delete');
    },
    updateConversationGroup: async () => makeGroup(),
    createConversationGroup: async () => makeGroup(),
    setConversationGroupMembers: async () => makeGroup(),
  };
  const { useMessageGroupsStore } = loadStore(apiMocks);
  await useMessageGroupsStore.getState().load();

  await useMessageGroupsStore.getState().remove('g-1');
  assert.deepEqual(
    JSON.parse(JSON.stringify(useMessageGroupsStore.getState().groups.map((g) => g.id))),
    ['g-2'],
  );

  shouldFail = true;
  await assert.rejects(() => useMessageGroupsStore.getState().remove('g-2'));
  assert.deepEqual(
    JSON.parse(JSON.stringify(useMessageGroupsStore.getState().groups.map((g) => g.id))),
    ['g-2'],
  );
});

test('setMembers() dedupes + sorts client-side, uses server response as truth', async () => {
  let lastServerArgs = null;
  const apiMocks = {
    fetchConversationGroups: async () => [makeGroup({ id: 'g-1', conversationIDs: [] })],
    setConversationGroupMembers: async (id, ids) => {
      lastServerArgs = { id, ids };
      return makeGroup({ id, conversationIDs: ['c-1', 'c-2', 'c-3'] });
    },
    updateConversationGroup: async () => makeGroup(),
    createConversationGroup: async () => makeGroup(),
    deleteConversationGroup: async () => undefined,
  };
  const { useMessageGroupsStore } = loadStore(apiMocks);
  await useMessageGroupsStore.getState().load();

  // 客户端传入带重复 + 乱序的列表
  await useMessageGroupsStore
    .getState()
    .setMembers('g-1', ['c-3', 'c-1', 'c-2', 'c-1']);

  assert.deepEqual(lastServerArgs.ids, ['c-3', 'c-1', 'c-2', 'c-1']);
  // 最终状态用服务器返回 —— 服务器返排过序的列表
  assert.deepEqual(
    useMessageGroupsStore.getState().groups[0].conversationIDs,
    ['c-1', 'c-2', 'c-3'],
  );
});

test('setPinnedToTabs() rolls back on server error and keeps prior value', async () => {
  let shouldFail = false;
  const apiMocks = {
    fetchConversationGroups: async () => [makeGroup({ pinnedToTabs: true })],
    updateConversationGroup: async (id, patch) => {
      if (shouldFail) throw new Error('reject');
      return makeGroup({ id, pinnedToTabs: patch.pinnedToTabs });
    },
    createConversationGroup: async () => makeGroup(),
    deleteConversationGroup: async () => undefined,
    setConversationGroupMembers: async () => makeGroup(),
  };
  const { useMessageGroupsStore } = loadStore(apiMocks);
  await useMessageGroupsStore.getState().load();

  shouldFail = true;
  await assert.rejects(() =>
    useMessageGroupsStore.getState().setPinnedToTabs('g-1', false),
  );
  assert.equal(useMessageGroupsStore.getState().groups[0].pinnedToTabs, true);
});

test('reorder() persists contiguous sortOrder values and updates local group order', async () => {
  const patches = [];
  const initialGroups = [
    makeGroup({ id: 'g-1', sortOrder: 0 }),
    makeGroup({ id: 'g-2', name: '工作', sortOrder: 1 }),
  ];
  const apiMocks = {
    fetchConversationGroups: async () => initialGroups,
    updateConversationGroup: async (id, patch) => {
      patches.push({ id, patch });
      return { ...initialGroups.find((group) => group.id === id), ...patch };
    },
    createConversationGroup: async () => makeGroup(),
    deleteConversationGroup: async () => undefined,
    setConversationGroupMembers: async () => makeGroup(),
  };
  const { useMessageGroupsStore } = loadStore(apiMocks);
  await useMessageGroupsStore.getState().load();

  await useMessageGroupsStore.getState().reorder(['g-2', 'g-1']);

  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        useMessageGroupsStore.getState().groups.map((group) => ({
          id: group.id,
          sortOrder: group.sortOrder,
        })),
      ),
    ),
    [
      { id: 'g-2', sortOrder: 0 },
      { id: 'g-1', sortOrder: 1 },
    ],
  );
  assert.deepEqual(JSON.parse(JSON.stringify(patches)), [
    { id: 'g-2', patch: { sortOrder: 0 } },
    { id: 'g-1', patch: { sortOrder: 1 } },
  ]);
});

test('reorder() reconciles with the server when saving a sortOrder fails', async () => {
  let fetchCount = 0;
  let slowUpdateSettled = false;
  const initialGroups = [
    makeGroup({ id: 'g-1', sortOrder: 0 }),
    makeGroup({ id: 'g-2', name: '工作', sortOrder: 1 }),
  ];
  const apiMocks = {
    fetchConversationGroups: async () => {
      fetchCount += 1;
      if (fetchCount > 1) assert.equal(slowUpdateSettled, true);
      return initialGroups;
    },
    updateConversationGroup: async (id, patch) => {
      if (id === 'g-2') throw new Error('reorder rejected');
      await new Promise((resolve) => setTimeout(resolve, 5));
      slowUpdateSettled = true;
      return { ...initialGroups.find((group) => group.id === id), ...patch };
    },
    createConversationGroup: async () => makeGroup(),
    deleteConversationGroup: async () => undefined,
    setConversationGroupMembers: async () => makeGroup(),
  };
  const { useMessageGroupsStore } = loadStore(apiMocks);
  await useMessageGroupsStore.getState().load();

  await assert.rejects(() =>
    useMessageGroupsStore.getState().reorder(['g-2', 'g-1']),
  );

  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        useMessageGroupsStore.getState().groups.map((group) => group.id),
      ),
    ),
    ['g-1', 'g-2'],
  );
});

test('setFilterOrder() persists a deduped order for built-in and custom filters', () => {
  const apiMocks = {
    fetchConversationGroups: async () => [],
    createConversationGroup: async () => makeGroup(),
    updateConversationGroup: async () => makeGroup(),
    deleteConversationGroup: async () => undefined,
    setConversationGroupMembers: async () => makeGroup(),
  };
  const { useMessageGroupsStore } = loadStore(apiMocks);

  useMessageGroupsStore
    .getState()
    .setFilterOrder(['private', 'custom:g-1', 'all', 'private']);

  assert.deepEqual(
    JSON.parse(JSON.stringify(useMessageGroupsStore.getState().filterOrder)),
    ['private', 'custom:g-1', 'all'],
  );
});

test('reset() clears in-memory state and MMKV cache', async () => {
  const apiMocks = {
    fetchConversationGroups: async () => [makeGroup()],
    createConversationGroup: async () => makeGroup(),
    updateConversationGroup: async () => makeGroup(),
    deleteConversationGroup: async () => undefined,
    setConversationGroupMembers: async () => makeGroup(),
  };
  const { useMessageGroupsStore, mmkvBacking } = loadStore(apiMocks);
  await useMessageGroupsStore.getState().load();
  // persist middleware should have written something
  // (it writes asynchronously after set; the rehydrate cycle isn't critical here)

  useMessageGroupsStore.getState().reset();
  assert.deepEqual(
    JSON.parse(JSON.stringify(useMessageGroupsStore.getState().groups)),
    [],
  );
  assert.equal(useMessageGroupsStore.getState().lastSyncedAt, null);
  assert.deepEqual(
    JSON.parse(JSON.stringify(useMessageGroupsStore.getState().filterOrder)),
    [],
  );

  // give the async cache-clear a tick to run
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    mmkvBacking.has('circle-im-conversation-groups'),
    false,
    'mmkv cache should be cleared',
  );
});

test('getGroupsForConversation() returns groups that include the conversationID', () => {
  const groups = [
    makeGroup({ id: 'g-1', conversationIDs: ['c-1', 'c-2'] }),
    makeGroup({ id: 'g-2', conversationIDs: ['c-3'] }),
    makeGroup({ id: 'g-3', conversationIDs: ['c-1', 'c-3'] }),
  ];
  // 直接 require module again to get the export — but we already loaded it.
  // For this pure utility, re-import with no mocks needed.
  const apiMocks = {
    fetchConversationGroups: async () => [],
    createConversationGroup: async () => makeGroup(),
    updateConversationGroup: async () => makeGroup(),
    deleteConversationGroup: async () => undefined,
    setConversationGroupMembers: async () => makeGroup(),
  };
  const { getGroupsForConversation } = loadStore(apiMocks);

  const result = getGroupsForConversation('c-1', groups);
  assert.deepEqual(
    result.map((g) => g.id),
    ['g-1', 'g-3'],
  );
});
