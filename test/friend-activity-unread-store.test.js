const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { withObservabilityStubs } = require('./helpers/observability-stubs');

function loadTsModule(relativePath, stubs = {}) {
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
    require: withObservabilityStubs((specifier) => {
      if (specifier in stubs) {
        return stubs[specifier];
      }

      return require(specifier);
    }),
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });

  return context.module.exports;
}

test('friend activity unread store refreshes count from API and decrements after marking read', async () => {
  const { useFriendActivityUnreadStore } = loadTsModule(
    'src/stores/friendActivityUnreadStore.ts',
    {
      '@/services/api/friends': {
        fetchUnreadFriendActivityCount: async () => 3,
      },
      '@/stores/tabBadgeStore': {
        useTabBadgeStore: {
          getState: () => ({
            setContactsUnread: () => {},
          }),
        },
      },
    },
  );

  await useFriendActivityUnreadStore.getState().refresh();
  assert.equal(useFriendActivityUnreadStore.getState().count, 3);

  useFriendActivityUnreadStore.getState().markRead(['a-1', 'a-2']);
  assert.equal(useFriendActivityUnreadStore.getState().count, 1);
});

test('friend activity unread store hides an unconfirmed count when refresh fails', async () => {
  const tabWrites = [];
  const { useFriendActivityUnreadStore } = loadTsModule(
    'src/stores/friendActivityUnreadStore.ts',
    {
      '@/services/api/friends': {
        fetchUnreadFriendActivityCount: async () => {
          throw new Error('network');
        },
      },
      '@/stores/tabBadgeStore': {
        useTabBadgeStore: {
          getState: () => ({
            setContactsUnread: (count) => tabWrites.push(count),
          }),
        },
      },
    },
  );

  useFriendActivityUnreadStore.setState({ count: 4, countKnown: true });
  await useFriendActivityUnreadStore.getState().refresh();

  assert.equal(useFriendActivityUnreadStore.getState().count, 4);
  assert.equal(useFriendActivityUnreadStore.getState().countKnown, false);
  assert.deepEqual(tabWrites, [0]);
});

function loadReadFlow(api) {
  const tabWrites = [];
  const unreadStoreModule = loadTsModule('src/stores/friendActivityUnreadStore.ts', {
    '@/services/api/friends': api,
    '@/stores/tabBadgeStore': {
      useTabBadgeStore: {
        getState: () => ({ setContactsUnread: (count) => tabWrites.push(count) }),
      },
    },
  });
  const readModule = loadTsModule(
    'src/features/contacts/utils/mark-friend-activities-read.ts',
    {
      '@/services/api/friends': api,
      '@/stores/friendActivityUnreadStore': unreadStoreModule,
    },
  );
  return { ...unreadStoreModule, ...readModule, tabWrites };
}

test('read acknowledgements do not subtract again after the server broadcasts updated counts', async () => {
  const api = {
    markFriendActivityRead: async (id) => {
      useFriendActivityUnreadStore.getState().setRealtimeCount(id === 'a-1' ? 4 : 3);
    },
  };
  const { useFriendActivityUnreadStore, markFriendActivitiesRead, tabWrites } =
    loadReadFlow(api);
  useFriendActivityUnreadStore.getState().setRealtimeCount(5);

  const readIds = await markFriendActivitiesRead(['a-1', 'a-2']);

  assert.deepEqual(Array.from(readIds), ['a-1', 'a-2']);
  assert.equal(useFriendActivityUnreadStore.getState().count, 3);
  assert.equal(tabWrites.at(-1), 3);
});

test('partial read failures reconcile the total and keep failed activities unread', async () => {
  const requestedIds = [];
  const api = {
    fetchUnreadFriendActivityCount: async () => 4,
    markFriendActivityRead: async (id) => {
      requestedIds.push(id);
      if (id === 'a-2') throw new Error('offline');
      useFriendActivityUnreadStore.getState().setRealtimeCount(4);
    },
  };
  const { useFriendActivityUnreadStore, markFriendActivitiesRead, tabWrites } =
    loadReadFlow(api);
  useFriendActivityUnreadStore.getState().setRealtimeCount(5);

  const readIds = await markFriendActivitiesRead(['a-1', 'a-2']);

  assert.deepEqual(Array.from(readIds), ['a-1']);
  assert.deepEqual(requestedIds, ['a-1', 'a-2']);
  assert.equal(useFriendActivityUnreadStore.getState().count, 4);
  assert.equal(useFriendActivityUnreadStore.getState().countKnown, true);
  assert.equal(useFriendActivityUnreadStore.getState().locallyReadIds.size, 0);
  assert.equal(tabWrites.at(-1), 4);
});

test('friend activity unread store ignores a refresh response that started before a local read', async () => {
  let resolveRequest;
  const tabWrites = [];
  const { useFriendActivityUnreadStore } = loadTsModule(
    'src/stores/friendActivityUnreadStore.ts',
    {
      '@/services/api/friends': {
        fetchUnreadFriendActivityCount: () =>
          new Promise((resolve) => {
            resolveRequest = resolve;
          }),
      },
      '@/stores/tabBadgeStore': {
        useTabBadgeStore: {
          getState: () => ({
            setContactsUnread: (count) => tabWrites.push(count),
          }),
        },
      },
    },
  );

  useFriendActivityUnreadStore.setState({
    count: 4,
    countKnown: true,
    locallyReadIds: new Set(),
  });
  const refreshPromise = useFriendActivityUnreadStore.getState().refresh();
  await new Promise((resolve) => setImmediate(resolve));
  useFriendActivityUnreadStore.getState().markRead(['a-1']);
  resolveRequest(4);
  await refreshPromise;

  assert.equal(useFriendActivityUnreadStore.getState().count, 3);
  assert.equal(useFriendActivityUnreadStore.getState().countKnown, true);
  assert.deepEqual(tabWrites, [3]);
});

test('friend activity realtime counts update the shared store and invalidate refreshes', async () => {
  let resolveRequest;
  const tabWrites = [];
  const { useFriendActivityUnreadStore } = loadTsModule(
    'src/stores/friendActivityUnreadStore.ts',
    {
      '@/services/api/friends': {
        fetchUnreadFriendActivityCount: () =>
          new Promise((resolve) => {
            resolveRequest = resolve;
          }),
      },
      '@/stores/tabBadgeStore': {
        useTabBadgeStore: {
          getState: () => ({
            setContactsUnread: (count) => tabWrites.push(count),
          }),
        },
      },
    },
  );

  const refreshPromise = useFriendActivityUnreadStore.getState().refresh();
  await new Promise((resolve) => setImmediate(resolve));
  useFriendActivityUnreadStore.getState().setRealtimeCount(7);
  resolveRequest(2);
  await refreshPromise;

  assert.equal(useFriendActivityUnreadStore.getState().count, 7);
  assert.equal(useFriendActivityUnreadStore.getState().countKnown, true);
  assert.deepEqual(tabWrites, [7]);
});

test('friend activity markRead dedupes by activity id — repeat taps do not double-decrement (#105)', async () => {
  const { useFriendActivityUnreadStore } = loadTsModule(
    'src/stores/friendActivityUnreadStore.ts',
    {
      '@/services/api/friends': {
        fetchUnreadFriendActivityCount: async () => 5,
      },
      '@/stores/tabBadgeStore': {
        useTabBadgeStore: {
          getState: () => ({
            setContactsUnread: () => {},
          }),
        },
      },
    },
  );

  await useFriendActivityUnreadStore.getState().refresh();
  assert.equal(useFriendActivityUnreadStore.getState().count, 5);

  // 同一行连点两次：只扣一次
  useFriendActivityUnreadStore.getState().markRead(['a-1', 'a-2']);
  useFriendActivityUnreadStore.getState().markRead(['a-1', 'a-2']);
  assert.equal(useFriendActivityUnreadStore.getState().count, 3);

  // 传入自带重复 id 也只按唯一 id 扣
  useFriendActivityUnreadStore.getState().markRead(['a-3', 'a-3']);
  assert.equal(useFriendActivityUnreadStore.getState().count, 2);

  // refresh 拿到服务端权威计数后，本地身份表清空：同一 id 可再次扣
  //（覆盖 mark-read 请求失败、服务端仍算未读的场景）
  await useFriendActivityUnreadStore.getState().refresh();
  assert.equal(useFriendActivityUnreadStore.getState().count, 5);
  useFriendActivityUnreadStore.getState().markRead(['a-1']);
  assert.equal(useFriendActivityUnreadStore.getState().count, 4);
});
