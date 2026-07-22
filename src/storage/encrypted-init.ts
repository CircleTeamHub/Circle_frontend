import * as SecureStore from 'expo-secure-store';
import { getRandomBytesAsync } from 'expo-crypto';
import { createMMKV, type MMKV } from 'react-native-mmkv';

/**
 * encrypted-init.ts — MMKV 加密初始化（FE#87）
 *
 * 目标：本地聊天缓存/偏好不再明文落盘。密钥存 Keychain/Keystore
 * （expo-secure-store），MMKV 用它做 AES 加密；react-native-mmkv 的
 * encryptionKey 是纯运行时参数，**无需 native 重建**。
 *
 * 启动时序约束：SecureStore 只有异步 API，而旧代码在模块求值期就同步用
 * storage —— 因此拆成「同步壳 + 异步初始化」：
 * - initEncryptedStorage() 在 app/_layout 的启动门（splash 未隐藏）内 await，
 *   完成后才渲染应用；
 * - 初始化前的同步读走 storage 壳的未就绪回退（返回 undefined + dev 告警），
 *   仅 i18n 模块求值和主题首读会触达，二者都有「门后重应用」补偿。
 *
 * 打开失败的恢复阶梯（PR #128 review 两条 P1）——不变量：**绝不返回明文实例**：
 * 1. 正常：encryptionKey 直开（首启则明文开 + recrypt 就地加密，零数据丢失）。
 * 2. 密钥在库坏（典型：iOS 卸载重装 Keychain 幸存）：明文重开 + 清库 +
 *    recrypt 重建为加密库（缓存可从服务端重同步；登录态在 SecureStore）。
 * 3. 连明文都打不开 / recrypt 失败（库文件损坏）：换 id 新建加密恢复库，
 *    并在 SecureStore 落标记，后续启动直达恢复库，数据不在两库间摇摆。
 * 4. 恢复库也建不起来（MMKV native 整体不可用）：init 拒绝并清缓存的
 *    promise（后续调用可重试），app 以壳回退模式继续启动 —— 本次进程无
 *    持久化，但绝无明文落盘。
 */
const ENCRYPTION_KEY_STORE_KEY = 'circle-im-mmkv-encryption-key';
const ACTIVE_STORE_MARKER_KEY = 'circle-im-mmkv-active-store';
const STORE_ID = 'circle-im';
const RECOVERY_STORE_ID = 'circle-im-r1';

// 与 secure-auth-storage 的 token 同级：首次解锁后（含再次锁屏）可读。
// review P2：默认的 WHEN_UNLOCKED 下，锁屏期间冷启动读不到密钥会让本次
// 进程永远没有持久化。
const KEYCHAIN_ACCESS = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
} as const;

let instance: MMKV | null = null;
let initPromise: Promise<MMKV> | null = null;

function warnDev(message: string, error?: unknown): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn(message, error);
  }
}

async function readOrCreateKey(): Promise<{ key: string; fresh: boolean }> {
  const existing = await SecureStore.getItemAsync(ENCRYPTION_KEY_STORE_KEY);
  if (existing) return { key: existing, fresh: false };
  const bytes = await getRandomBytesAsync(32);
  const key = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  await SecureStore.setItemAsync(ENCRYPTION_KEY_STORE_KEY, key, KEYCHAIN_ACCESS);
  return { key, fresh: true };
}

/** 阶梯 3：换 id 新建加密恢复库并落标记。这里再抛就交给 init 的最终 catch。 */
async function openRecoveryStore(key: string): Promise<MMKV> {
  const recovery = createMMKV({ id: RECOVERY_STORE_ID, encryptionKey: key });
  await SecureStore.setItemAsync(
    ACTIVE_STORE_MARKER_KEY,
    RECOVERY_STORE_ID,
    KEYCHAIN_ACCESS,
  );
  return recovery;
}

async function openStore(key: string, fresh: boolean): Promise<MMKV> {
  // 上次启动已切换到恢复库：直达，避免主库时好时坏导致数据摇摆。
  const marker = await SecureStore.getItemAsync(ACTIVE_STORE_MARKER_KEY).catch(
    () => null,
  );
  if (marker === RECOVERY_STORE_ID) {
    return createMMKV({ id: RECOVERY_STORE_ID, encryptionKey: key });
  }

  try {
    if (fresh) {
      // 首次启用（或全新安装）：明文旧库先原样打开再就地加密。
      // 全新安装时这就是个空库，recrypt 零成本。
      const legacy = createMMKV({ id: STORE_ID });
      legacy.recrypt(key);
      return legacy;
    }
    return createMMKV({ id: STORE_ID, encryptionKey: key });
  } catch (primaryError) {
    warnDev('[storage] primary MMKV open failed; rebuilding store', primaryError);
    try {
      // 阶梯 2：明文重开 + 清库 + 就地加密。任何一步失败都不得把明文实例
      // 放出去（review P1：那会让后续写入静默明文落盘，加密保证归零）。
      const rebuilt = createMMKV({ id: STORE_ID });
      rebuilt.clearAll();
      rebuilt.recrypt(key);
      return rebuilt;
    } catch (rebuildError) {
      warnDev(
        '[storage] plaintext rebuild failed; switching to recovery store',
        rebuildError,
      );
      return openRecoveryStore(key);
    }
  }
}

/**
 * 在 app 启动门内 await；完成前 storage 壳的读写走未就绪回退。
 * 幂等：并发/重复调用共享同一次初始化；失败会清掉缓存的 promise，
 * 后续调用（如 zustand 异步水合路径）可重试。
 */
export function initEncryptedStorage(): Promise<MMKV> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const { key, fresh } = await readOrCreateKey();
    instance = await openStore(key, fresh);
    return instance;
  })().catch((error) => {
    initPromise = null;
    throw error;
  });
  return initPromise;
}

/** 已初始化的实例；未初始化返回 null（storage 壳据此走回退）。 */
export function getEncryptedInstance(): MMKV | null {
  return instance;
}
