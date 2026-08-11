const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// FE#87 启动时序契约：加密 MMKV 初始化必须发生在启动门内、且先于
// AsyncStorage 迁移（迁移通过 storage 壳写入，壳未就绪写入会被丢弃）；
// 语言重应用在两者之后。

function read(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('root layout awaits initEncryptedStorage before migration, then reapplies language', () => {
  const source = read('app/_layout.tsx');

  const initIndex = source.indexOf('await initEncryptedStorage()');
  const migrateIndex = source.indexOf('await migrateFromAsyncStorage()');
  const rehydrateIndex = source.indexOf('rehydrateLanguageFromStorage()');

  assert.ok(initIndex >= 0, '启动门必须 await initEncryptedStorage()');
  assert.ok(migrateIndex >= 0, '启动门必须 await migrateFromAsyncStorage()');
  assert.ok(rehydrateIndex >= 0, '门后必须重应用语言偏好');
  assert.ok(
    initIndex < migrateIndex,
    '加密初始化必须先于迁移 —— 迁移写走 storage 壳，壳未就绪会丢写',
  );
  assert.ok(migrateIndex < rehydrateIndex, '语言重应用必须在迁移之后');
});

test('storage shell tolerates pre-init reads and index re-exports the initializer', () => {
  const source = read('src/storage/index.ts');

  assert.match(source, /getEncryptedInstance\(\)/);
  assert.match(source, /export \{ initEncryptedStorage \}/);
  // 壳的读回退（i18n 模块求值期会触达）
  assert.match(source, /warnNotReady\('getString', key\);\s*return undefined;/);
});

// 回执挂账队列的孤儿键清理(review 反馈)。
//
// 那个队列在 OpenIM 时代(2026-07-21 起)真实跑过:发卡成功后把支付幂等键挂进
// MMKV 等回执冲销。2026-08-08 换自研聊天栈后发卡一律被拒、不再有新增,但**冲销
// 失败**留下的旧条目还在。卡片改服务端签发后队列实现与回执端点都删了 ——
// 不显式清就永远留在用户机器上(最多 100 条,每条含一枚幂等键 + userId)。
const PENDING_ACKS_KEY = 'circle-im-gift-card-pending-acks';

function loadStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  const mmkv = {
    getString: (k) => store.get(k),
    getBoolean: (k) => store.get(k),
    set: (k, v) => store.set(k, v),
    remove: (k) => store.delete(k),
    contains: (k) => store.has(k),
    clearAll: () => store.clear(),
    getAllKeys: () => [...store.keys()],
  };
  const mod = loadTsModule('src/storage/index.ts', {
    requireShim: (specifier) => {
      if (specifier === '@react-native-async-storage/async-storage') {
        return {
          default: {
            multiGet: async () => [],
            multiRemove: async () => {},
          },
        };
      }
      if (specifier === './encrypted-init') {
        return {
          getEncryptedInstance: () => mmkv,
          initEncryptedStorage: async () => {},
        };
      }
      throw new Error(`unexpected import in storage/index: ${specifier}`);
    },
    context: { __DEV__: false, console },
  });
  return { mod, store };
}

test('升级清理:回执挂账队列的孤儿键被抹掉', () => {
  const { mod, store } = loadStorage({
    [PENDING_ACKS_KEY]: JSON.stringify([
      { key: 'idem-key-1', userId: 'user-1' },
    ]),
    'circle-im-theme-mode': 'dark',
  });

  mod.purgeOrphanedKeys();

  assert.equal(store.has(PENDING_ACKS_KEY), false, '孤儿键必须删掉');
  // 只删清单里的键,别的偏好一个都不能碰。
  assert.equal(store.get('circle-im-theme-mode'), 'dark');
});

test('升级清理:幂等,且不被早已置位的迁移 flag 挡住', () => {
  // MIGRATION_FLAG 在这些键产生之前就为老用户置位了 —— 把清理挂在它后面
  // 等于对最需要清理的那批人永远不执行。
  const { mod, store } = loadStorage({
    [PENDING_ACKS_KEY]: '[]',
    __migrated_from_async_storage_v1: true,
  });

  mod.purgeOrphanedKeys();
  mod.purgeOrphanedKeys();

  assert.equal(store.has(PENDING_ACKS_KEY), false);
  assert.equal(store.get('__migrated_from_async_storage_v1'), true);
});

test('升级清理:没有孤儿键时是零副作用的 no-op', () => {
  const { mod, store } = loadStorage({ 'circle-im-auth': '{}' });
  mod.purgeOrphanedKeys();
  assert.deepEqual([...store.keys()], ['circle-im-auth']);
});
