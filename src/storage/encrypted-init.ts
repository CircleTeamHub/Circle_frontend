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
 * 迁移：首次带密钥启动时，旧的明文实例先原样打开，再 recrypt(key) 就地
 * 加密 —— 数据零丢失。密钥丢失（Keychain 被清）而库仍加密时，视为不可
 * 恢复缓存：删库重建（聊天记录可从 OpenIM 重新同步；auth token 本就在
 * SecureStore，不受影响）。
 */
const ENCRYPTION_KEY_STORE_KEY = 'circle-im-mmkv-encryption-key';
const STORE_ID = 'circle-im';

let instance: MMKV | null = null;
let initPromise: Promise<MMKV> | null = null;

async function readOrCreateKey(): Promise<{ key: string; fresh: boolean }> {
  const existing = await SecureStore.getItemAsync(ENCRYPTION_KEY_STORE_KEY);
  if (existing) return { key: existing, fresh: false };
  const bytes = await getRandomBytesAsync(32);
  const key = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  await SecureStore.setItemAsync(ENCRYPTION_KEY_STORE_KEY, key);
  return { key, fresh: true };
}

function openEncrypted(key: string, fresh: boolean): MMKV {
  if (fresh) {
    // 首次启用（或全新安装）：明文旧库先原样打开再就地加密。
    // 全新安装时这就是个空库，recrypt 零成本。
    const legacy = createMMKV({ id: STORE_ID });
    legacy.recrypt(key);
    return legacy;
  }
  return createMMKV({ id: STORE_ID, encryptionKey: key });
}

/**
 * 在 app 启动门内 await；完成前 storage 壳的读写走未就绪回退。
 * 幂等：并发/重复调用共享同一次初始化。
 */
export function initEncryptedStorage(): Promise<MMKV> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const { key, fresh } = await readOrCreateKey();
    try {
      instance = openEncrypted(key, fresh);
    } catch (error) {
      // 密钥在（Keychain 幸存）但库打不开：典型于 iOS 卸载重装 —— Keychain
      // 跨安装保留而 app 容器被清后又出现半损库，或密钥/库错配。缓存不可
      // 恢复即重建（内容都能从服务端重新同步）。
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn(
          '[storage] encrypted MMKV open failed; recreating store',
          error,
        );
      }
      const fallback = createMMKV({ id: STORE_ID });
      try {
        fallback.clearAll();
        fallback.recrypt(key);
        instance = fallback;
      } catch {
        // 连明文打开都失败：放弃加密（保持可用性），密钥留待下次启动再试。
        instance = fallback;
      }
    }
    return instance;
  })();
  return initPromise;
}

/** 已初始化的实例；未初始化返回 null（storage 壳据此走回退）。 */
export function getEncryptedInstance(): MMKV | null {
  return instance;
}
