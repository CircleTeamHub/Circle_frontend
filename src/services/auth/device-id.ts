/**
 * device-id.ts — 本机设备标识
 *
 * 首次使用时生成一个随机 ID，存进安全存储（原生 Keychain/Keystore，网页 localStorage），
 * 之后每个请求都以 X-Device-Id 头带上。服务端只存它的哈希，用来判断「这台设备是否
 * 受信任」：陌生设备登录要先经受信任设备批准。
 *
 * - THIS_DEVICE_ONLY：不随 iCloud 备份迁到新手机 —— 新手机就该算新设备。
 * - 读写失败时返回 null（请求照发、不带头），不阻断任何业务请求；下次再试。
 */
import { randomUUID } from 'expo-crypto';
import { getSecureKv } from '@/storage/secure-kv';

const DEVICE_ID_KEY = 'circle.device-id.v1';
// 与服务端 hashDeviceId 的白名单一致：不合规的值服务端当没带。
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

let deviceIdPromise: Promise<string | null> | null = null;

async function loadOrCreateDeviceId(): Promise<string> {
  const kv = await getSecureKv();
  const existing = await kv.getItemAsync(DEVICE_ID_KEY);
  if (existing && DEVICE_ID_PATTERN.test(existing)) {
    return existing;
  }
  const created = randomUUID();
  await kv.setItemAsync(DEVICE_ID_KEY, created, {
    keychainAccessible: kv.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  return created;
}

export function getDeviceId(): Promise<string | null> {
  deviceIdPromise ??= loadOrCreateDeviceId().catch(() => {
    // 不缓存失败：安全存储暂时不可读（如锁屏冷启动）时，下一个请求再试。
    deviceIdPromise = null;
    return null;
  });
  return deviceIdPromise;
}
