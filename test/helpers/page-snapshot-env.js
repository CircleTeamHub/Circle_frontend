const { loadTsModule } = require('./load-ts-module');
const { createMemoryMmkv } = require('./native-storage-stubs');

/**
 * 按账号加密落盘的页面快照环境:真实 src/storage/page-snapshots + 内存 MMKV + 可切换的登录态。
 *
 * load() 每调一次装出一份新的模块实例(内存缓存是空的),同一个 env 下再 load 一次
 * 就等于「App 重启后」从盘里恢复。signIn() 切账号并推进 sessionEpoch,和真实登录一样。
 * overrides 按 import 路径替换被测模块的个别依赖(比如写请求记号)。
 */
function createPageSnapshotEnv() {
  const mmkv = createMemoryMmkv();
  const auth = { user: null, isAuthenticated: false, sessionEpoch: 0 };
  const authStore = { useAuthStore: { getState: () => auth } };
  const encryptedInit = { getEncryptedInstance: () => mmkv };
  let snapshots;
  const shim = (overrides = {}) => (request) => {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request];
    if (request === '@/stores/authStore') return authStore;
    if (request === '@/storage/encrypted-init' || request === './encrypted-init') return encryptedInit;
    if (request === '@/storage') return { storage: mmkv };
    if (request === '@/storage/page-snapshots') return snapshots;
    return require(request);
  };
  snapshots = loadTsModule('src/storage/page-snapshots.ts', { requireShim: shim() });

  return {
    auth,
    mmkv,
    snapshots,
    signIn(userId) {
      auth.user = { id: userId };
      auth.isAuthenticated = true;
      auth.sessionEpoch += 1;
      return auth.sessionEpoch;
    },
    load: (relativePath, overrides) => loadTsModule(relativePath, { requireShim: shim(overrides) }),
  };
}

/** 从盘里恢复的对象出自 vm 里的 JSON.parse,原型不是本测试环境的;断言前转成普通对象。 */
const plain = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

module.exports = { createPageSnapshotEnv, plain };
