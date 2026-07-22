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

test('发朋友圈：九图并发上传 cap=3；picker 先开、失败才引导 (#108, review 修复)', () => {
  const screen = read('src/features/discover/screens/CreateMomentScreen.tsx');
  assert.match(screen, /mapWithConcurrency\(images, 3,/);
  assert.doesNotMatch(screen, /for \(const uri of images\)/);
  // review 修复：iOS PHPicker / Android 13+ 系统 picker 无需相册权限 ——
  // 前置权限门禁会把「拒绝过广义相册权限」的用户挡在不需要权限的入口外。
  // 直接 launch；仅 launch 失败（老系统真需要权限）才提示。
  assert.doesNotMatch(screen, /requestMediaLibraryPermissionsAsync/);
  const picker = screen.slice(
    screen.indexOf('const handlePickImages'),
    screen.indexOf('const handleRemoveImage'),
  );
  assert.match(picker, /launchImageLibraryAsync/);
  // 失败路径仍引导权限设置文案
  assert.match(picker, /catch[\s\S]*validation\.albumPermission/);
  // 上传结果保序：uploadedUrls 从 outcomes 过滤而来
  assert.match(screen, /outcomes\.filter\(/);
});

test('圈子单飞按会话/变更作用域失效 (review P1)', async () => {
  const gate = deferred();
  let sessionUser = 'A';
  const { mod, calls } = loadCirclesStore({
    fetchMyCirclesImpl: async (kind) => {
      const owner = sessionUser; // 请求发起时归属的会话
      await gate.promise;
      if (kind === 'joined' && owner === 'A')
        return [{ id: 'stale-a', name: 'A 的圈子', myRole: 'MEMBER' }];
      return [];
    },
  });
  const store = mod.useCirclesStore;

  // A 会话拉取在飞
  const staleRun = store.getState().fetchMyCircles();
  assert.equal(calls.my.length, 3);

  // 登出/切号：reset 必须清句柄 + 使在飞写入失效
  store.getState().reset();
  sessionUser = 'B';

  // B 会话的拉取不能复用 A 的在飞请求（句柄已清 → 重新起飞）
  const freshRun = store.getState().fetchMyCircles();
  assert.equal(calls.my.length, 6);

  // 双方响应都落地后：A 的写入被代际守卫丢弃，B 的 store 不含 A 的圈子
  gate.resolve();
  await staleRun;
  await freshRun;
  assert.deepEqual(
    JSON.parse(JSON.stringify(store.getState().joinedCircles)),
    [],
  );
});

test('removeCircle 使在飞快照作废：退圈后 focus 刷新不再复活旧圈子 (round 2)', async () => {
  const gate = deferred();
  let batch = 0;
  const { mod, calls } = loadCirclesStore({
    fetchMyCirclesImpl: async (kind) => {
      const myBatch = batch;
      await gate.promise;
      if (kind === 'joined') {
        return myBatch === 0
          ? [{ id: 'circle-x', name: '退圈前快照', myRole: 'MEMBER' }]
          : [];
      }
      return [];
    },
  });
  const store = mod.useCirclesStore;

  // 退圈前出发的拉取在飞
  const staleRun = store.getState().fetchMyCircles();
  assert.equal(calls.my.length, 3);

  // 用户退圈（CircleDetail 调 removeCircle 后 router.back()）
  store.getState().removeCircle('circle-x');
  batch = 1;

  // 返回广场：focus 刷新走默认拉取 —— 句柄已被 removeCircle 清掉，重新起飞
  const focusRun = store.getState().fetchMyCircles();
  assert.equal(calls.my.length, 6);

  gate.resolve();
  await Promise.all([staleRun, focusRun]);
  // 旧快照写入被代际守卫压掉：刚退的圈子不会复活
  assert.deepEqual(
    JSON.parse(JSON.stringify(store.getState().joinedCircles)),
    [],
  );
});

test('退圈失效同时清 loading；join/edit 也走强刷 (round 3)', async () => {
  const gate = deferred();
  const { mod } = loadCirclesStore({
    fetchMyCirclesImpl: async () => {
      await gate.promise;
      return [];
    },
  });
  const store = mod.useCirclesStore;

  const run = store.getState().fetchMyCircles();
  assert.equal(store.getState().myCirclesLoading, true);
  // 退圈作废在飞：loading 必须立刻清掉（被作废的 run 走不到 finally）
  store.getState().removeCircle('c-x');
  assert.equal(store.getState().myCirclesLoading, false);
  gate.resolve();
  await run;
  assert.equal(store.getState().myCirclesLoading, false);

  // join/edit 的调用点带 force
  const detail = read('src/features/discover/screens/CircleDetailScreen.tsx');
  assert.match(detail, /fetchMyCircles\(\{ force: true \}\)/);
  const edit = read('src/features/discover/screens/EditCircleScreen.tsx');
  assert.match(edit, /fetchMyCircles\(\{ force: true \}\)/);
});

test('force 拉取绕过在飞合并（建圈后强制重拉）(review P1)', async () => {
  const gate = deferred();
  let batch = 0;
  const { mod, calls } = loadCirclesStore({
    fetchMyCirclesImpl: async (kind) => {
      const myBatch = batch;
      await gate.promise;
      if (kind === 'joined') {
        return myBatch === 0
          ? [{ id: 'pre-create', name: '旧快照', myRole: 'MEMBER' }]
          : [{ id: 'post-create', name: '含新圈子', myRole: 'MEMBER' }];
      }
      return [];
    },
  });
  const store = mod.useCirclesStore;

  // 变更前出发的普通拉取在飞
  const staleRun = store.getState().fetchMyCircles();
  assert.equal(calls.my.length, 3);

  // 建圈成功后 force 重拉：不合并进旧在飞
  batch = 1;
  const forcedRun = store.getState().fetchMyCircles({ force: true });
  assert.equal(calls.my.length, 6);

  gate.resolve();
  await Promise.all([staleRun, forcedRun]);
  // 最终以 force 批次为准（旧快照写入被代际守卫压掉；即便旧响应后落地也一样）
  assert.deepEqual(
    JSON.parse(JSON.stringify(store.getState().joinedCircles)).map(
      (c) => c.id,
    ),
    ['post-create'],
  );
  // CreateCircleScreen 的建圈后调用已带 force
  const createScreen = read(
    'src/features/discover/screens/CreateCircleScreen.tsx',
  );
  assert.match(createScreen, /fetchMyCircles\(\{ force: true \}\)/);
});
