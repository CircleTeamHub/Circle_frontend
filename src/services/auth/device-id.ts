/**
 * device-id.ts — 本机设备标识
 *
 * 首次使用时确定一个设备 ID，存进安全存储（原生 Keychain/Keystore，网页端只在内存里），
 * 之后每个请求都以 X-Device-Id 头带上。服务端只存它的哈希，用来判断「这台设备是否
 * 受信任」：陌生设备登录要先经受信任设备批准。
 *
 * - 重装后要认得出同一台手机，否则只有一台设备的账号重装后就没人能批准登录：
 *   - iOS：Keychain 在卸载后保留，随机 ID 重装后仍在。
 *   - 安卓：安全存储随卸载清空，所以新装时改由 ANDROID_ID 推导（同一台手机、同一个
 *     签名的 App 重装后不变，恢复出厂才变）。只发它的加盐摘要，不发原值。
 * - 已经存过 ID 的安装继续用原来的：会话在服务端绑定了原 ID，换掉就成了陌生设备。
 * - THIS_DEVICE_ONLY：不随 iCloud 备份迁到新手机 —— 新手机就该算新设备。
 * - 读写失败时返回 null（请求照发、不带头），不阻断任何业务请求；下次再试。
 */
import { Platform } from 'react-native';
import * as Application from 'expo-application';
import {
  CryptoDigestAlgorithm,
  digestStringAsync,
  randomUUID,
} from 'expo-crypto';
import { getSecureKv } from '@/storage/secure-kv';

const DEVICE_ID_KEY = 'circle.device-id.v1';
// 与服务端 hashDeviceId 的白名单一致：不合规的值服务端当没带。
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
// 摘要的命名空间：同一个 ANDROID_ID 换个用途不会算出同一个设备 ID。
const ANDROID_ID_NAMESPACE = 'circle-device-v1';

let deviceIdPromise: Promise<string | null> | null = null;

/** 安卓：由 ANDROID_ID 推导、重装后不变的设备 ID；拿不到时返回 null。 */
async function stableAndroidDeviceId(): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const androidId = Application.getAndroidId();
    if (typeof androidId !== 'string' || !/^[0-9a-f]{16}$/i.test(androidId) ||
        /^(.)\1{15}$/i.test(androidId) || androidId.toLowerCase() === '9774d56d682e549c') return null;
    const digest = await digestStringAsync(
      CryptoDigestAlgorithm.SHA256,
      `${ANDROID_ID_NAMESPACE}:${androidId}`,
    );
    return `a1-${digest}`;
  } catch {
    return null;
  }
}

async function loadOrCreateDeviceId(): Promise<string> {
  const kv = await getSecureKv();
  const existing = await kv.getItemAsync(DEVICE_ID_KEY);
  if (existing && DEVICE_ID_PATTERN.test(existing)) {
    return existing;
  }
  const created = (await stableAndroidDeviceId()) ?? randomUUID();
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
