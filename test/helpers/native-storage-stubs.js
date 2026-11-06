const path = require('node:path');

/**
 * 本地持久化层的桩：页面快照（@/storage/page-snapshots）按账号落进加密 MMKV，
 * 账号取自 authStore。这条链在 node --test 里装不起来——react-native 是 Flow
 * 源码、MMKV/AsyncStorage 是原生模块、authStore 又连着 zustand persist。
 *
 * 默认替身的语义是「没登录、存储可用（内存）」：
 * - react-native：只给 Platform（OS='ios'，即原生路径）；
 * - @/storage/encrypted-init、@/storage：同一份进程内内存 MMKV；
 * - @/stores/authStore：未登录、sessionEpoch=0。按账号落盘的快照因此全是空操作，
 *   被测模块的行为和改成持久化之前一样。要测缓存本身的测试自己提供 authStore。
 * - @/storage/page-snapshots：空操作（与未登录时的真实行为一致）。
 *
 * 与 observability-stubs 同一套约定：测试显式提供的导出优先（对象会合并在默认之上），
 * 测试的 require 抛错（「unexpected import」或真模块装不起来）时回落到这里。
 * 相对路径的 import（page-snapshots 里的 './encrypted-init'）按源码位置折算成
 * `@/...` 再查表。
 */
function createMemoryMmkv() {
  const values = new Map();
  const typed = (type) => (key) => (typeof values.get(key) === type ? values.get(key) : undefined);
  return {
    getString: typed('string'),
    getBoolean: typed('boolean'),
    getNumber: typed('number'),
    set: (key, value) => {
      values.set(key, value);
    },
    remove: (key) => values.delete(key),
    contains: (key) => values.has(key),
    getAllKeys: () => [...values.keys()],
    clearAll: () => values.clear(),
  };
}

function makeNativeStorageStubs() {
  const mmkv = createMemoryMmkv();
  const authState = { user: null, isAuthenticated: false, sessionEpoch: 0 };
  const useAuthStore = Object.assign((selector) => (selector ? selector(authState) : authState), {
    getState: () => authState,
    setState: () => {},
    subscribe: () => () => {},
  });
  return {
    'react-native': {
      Platform: { OS: 'ios', select: (options) => options.ios ?? options.native ?? options.default },
    },
    '@/storage/encrypted-init': {
      getEncryptedInstance: () => mmkv,
      initEncryptedStorage: async () => mmkv,
    },
    '@/storage': {
      storage: mmkv,
      mmkvJsonStorage: {
        getItem: (key) => mmkv.getString(key) ?? null,
        setItem: (key, value) => mmkv.set(key, value),
        removeItem: (key) => mmkv.remove(key),
      },
      initEncryptedStorage: async () => mmkv,
      purgeOrphanedKeys() {},
      migrateFromAsyncStorage: async () => {},
    },
    '@/stores/authStore': { useAuthStore },
    // 未登录时真实实现也全是空操作;要测快照本身的测试显式装真实模块。
    '@/storage/page-snapshots': {
      getPageSnapshotRevision: () => 0,
      getPageSnapshotStorageUsage: () => ({ entries: 0, bytes: 0 }),
      readPageSnapshot: () => null,
      writePageSnapshot() {},
      removePageSnapshot() {},
      clearPageSnapshots() {},
    },
  };
}

const NATIVE_STORAGE_STUBS = makeNativeStorageStubs();

/** `./x` / `../x` 折算成 `@/x`（只认 src 里的源码）；其余原样返回。 */
function aliasFor(request, fromFile) {
  if (!fromFile || !(request.startsWith('./') || request.startsWith('../'))) return request;
  const relative = path.relative(path.join(process.cwd(), 'src'), path.resolve(path.dirname(fromFile), request));
  return relative.startsWith('..') ? request : `@/${relative.split(path.sep).join('/')}`;
}

function withNativeStorageStubs(requireImpl, fromFile) {
  return (request) => {
    const key = aliasFor(request, fromFile);
    if (!Object.prototype.hasOwnProperty.call(NATIVE_STORAGE_STUBS, key)) {
      return requireImpl(request);
    }
    let provided;
    try {
      provided = requireImpl(request);
    } catch {
      provided = undefined;
    }
    return provided && typeof provided === 'object'
      ? { ...NATIVE_STORAGE_STUBS[key], ...provided }
      : NATIVE_STORAGE_STUBS[key];
  };
}

module.exports = { NATIVE_STORAGE_STUBS, createMemoryMmkv, withNativeStorageStubs };
