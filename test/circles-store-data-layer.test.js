const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function loadCirclesStore({ fetchMyCirclesImpl, fetchCirclesImpl } = {}) {
  const calls = { my: [], all: 0 };
  const shims = {
    zustand: require('zustand'),
    '@/services/api/circles': {
      fetchMyCircles: async (kind) => {
        calls.my.push(kind);
        if (fetchMyCirclesImpl) return fetchMyCirclesImpl(kind);
        return [];
      },
      fetchCircles: async () => {
        calls.all += 1;
        if (fetchCirclesImpl) return fetchCirclesImpl();
        return { items: [], total: 0 };
      },
    },
    '@/services/api/errors': {
      getApiErrorMessage: (_e, fallback) => fallback,
    },
    '@/utils/client-diagnostics': {
      logClientDiagnostic: () => {},
    },
    './managed-circles': loadTsModule(
      'src/features/discover/store/managed-circles.ts',
    ),
  };
  const mod = loadTsModule('src/features/discover/store/use-circles-store.ts', {
    requireShim: (specifier) => {
      if (shims[specifier]) return shims[specifier];
      throw new Error(`unexpected import in circles store: ${specifier}`);
    },
  });
  return { mod, calls };
}

test('fetchMyCircles 并发合并为一次请求，且不预清已渲染列表 (#106)', async () => {
  const gate = deferred();
  const seeded = [{ id: 'c1', name: 'seed', myRole: 'MEMBER' }];
  const { mod, calls } = loadCirclesStore({
    fetchMyCirclesImpl: async (kind) => {
      await gate.promise;
      if (kind === 'joined') return [{ id: 'c2', name: 'fresh', myRole: 'MEMBER' }];
      return [];
    },
  });
  const store = mod.useCirclesStore;

  // 预置一份已渲染数据，模拟第二次进入页面
  store.setState({ joinedCircles: seeded });

  const first = store.getState().fetchMyCircles();
  const second = store.getState().fetchMyCircles();

  // 在途期间：列表未被清空（旧行为是先 blank 再 await）
  assert.equal(store.getState().joinedCircles.length, 1);
  assert.equal(store.getState().joinedCircles[0].id, 'c1');
  assert.equal(store.getState().myCirclesLoading, true);

  gate.resolve();
  await Promise.all([first, second]);

  // 并发两次调用只发了一轮请求（joined/created/applied 各一次）
  assert.deepEqual(calls.my.sort(), ['applied', 'created', 'joined']);
  assert.equal(store.getState().joinedCircles[0].id, 'c2');
  assert.equal(store.getState().myCirclesLoading, false);

  // 完成后可再次拉取（单飞句柄已释放）
  await store.getState().fetchMyCircles();
  assert.equal(calls.my.length, 6);
});

test('fetchAllCircles 同样单飞 (#106)', async () => {
  const gate = deferred();
  const { mod, calls } = loadCirclesStore({
    fetchCirclesImpl: async () => {
      await gate.promise;
      return { items: [], total: 0 };
    },
  });
  const store = mod.useCirclesStore;

  const first = store.getState().fetchAllCircles();
  const second = store.getState().fetchAllCircles();
  gate.resolve();
  await Promise.all([first, second]);

  assert.equal(calls.all, 1);
});

test('mapWithConcurrency 保序、限并发、冒泡 mapper 异常', async () => {
  const { mapWithConcurrency } = loadTsModule('src/utils/concurrency.ts');

  let inFlight = 0;
  let peak = 0;
  const result = await mapWithConcurrency(
    [10, 20, 30, 40, 50],
    3,
    async (value, index) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5 - index));
      inFlight -= 1;
      return value * 2;
    },
  );

  // vm realm 里创建的数组原型与宿主不同，走 JSON round-trip 对比（仓内既有惯例）
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [20, 40, 60, 80, 100]);
  assert.ok(peak <= 3, `peak concurrency ${peak} exceeded cap`);

  await assert.rejects(
    mapWithConcurrency([1], 0, async (v) => v),
    /invalid limit/,
  );
  await assert.rejects(
    mapWithConcurrency([1, 2], 2, async (v) => {
      if (v === 2) throw new Error('boom');
      return v;
    }),
    /boom/,
  );
});

test('广场圈子快捷入口随焦点刷新 (#107)', () => {
  const feed = read('src/features/discover/components/plaza-feed.tsx');
  assert.match(feed, /useFocusEffect\(\s*useCallback\(\(\) => \{\s*void fetchMyCircles\(\)/);
  assert.doesNotMatch(feed, /useEffect\(\(\) => \{\s*fetchMyCircles\(\);\s*\}, \[fetchMyCircles\]\)/);
});

test('发朋友圈：九图并发上传 cap=3 且显式请求相册权限 (#108 #109)', () => {
  const screen = read('src/features/discover/screens/CreateMomentScreen.tsx');
  assert.match(screen, /mapWithConcurrency\(images, 3,/);
  assert.doesNotMatch(screen, /for \(const uri of images\)/);
  assert.match(screen, /requestMediaLibraryPermissionsAsync\(\)/);
  assert.match(screen, /validation\.albumPermission/);
  // 上传结果保序：uploadedUrls 从 outcomes 过滤而来
  assert.match(screen, /outcomes\.filter\(/);
});
