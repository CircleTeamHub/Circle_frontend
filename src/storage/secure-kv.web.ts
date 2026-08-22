import type * as SecureStoreModule from 'expo-secure-store';

/**
 * SecureStore 平台间接层的 Web 档（导出面与 secure-kv.ts 保持一致）。
 *
 * 浏览器没有系统钥匙串，任何写进 localStorage / IndexedDB 的登录凭证都能被
 * 同源脚本读取。这个平台档因此只保存在当前 JS 会话的内存里；刷新页面会要求
 * 重新登录，但不会把 access / refresh / IM token 留给后续 XSS 或受损依赖。
 *
 * SSG（expo export 静态渲染）在 Node 里求值：无 window 时读写落进程内
 * Map，导出产物不含任何 token。读取时顺手清理旧版本曾落进 localStorage 的值。
 */
export type SecureKvApi = Pick<
  typeof SecureStoreModule,
  | 'getItemAsync'
  | 'setItemAsync'
  | 'deleteItemAsync'
  | 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY'
>;

const PREFIX = 'circle-im.sec.';

const memoryStore = new Map<string, string>();
let legacyCleanupDone = false;

function getLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function clearLegacyPersistentValues(): void {
  if (legacyCleanupDone) return;
  const ls = getLocalStorage();
  if (!ls) return;
  try {
    for (let index = ls.length - 1; index >= 0; index -= 1) {
      const key = ls.key(index);
      if (key?.startsWith(PREFIX)) ls.removeItem(key);
    }
    legacyCleanupDone = true;
  } catch {
    // 下次访问再重试；当前会话仍只使用内存里的值。
  }
}

function read(key: string): string | null {
  clearLegacyPersistentValues();
  removeLegacyPersistentValue(key);
  return memoryStore.get(key) ?? null;
}

function write(key: string, value: string): void {
  clearLegacyPersistentValues();
  removeLegacyPersistentValue(key);
  memoryStore.set(key, value);
}

function removeLegacyPersistentValue(key: string): void {
  const ls = getLocalStorage();
  if (ls) {
    try {
      ls.removeItem(PREFIX + key);
    } catch {
      // 存储不可用时仍保持内存会话；这里不能为清理失败重新暴露旧值。
    }
  }
}

function remove(key: string): void {
  clearLegacyPersistentValues();
  removeLegacyPersistentValue(key);
  memoryStore.delete(key);
}

const webSecureKv: SecureKvApi = {
  // Keychain 可达性常量在 web 上没有对应物；调用方把它塞进 options，
  // 而 options 在本档被整体忽略。
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
  async getItemAsync(key: string): Promise<string | null> {
    return read(key);
  },
  async setItemAsync(key: string, value: string): Promise<void> {
    write(key, value);
  },
  async deleteItemAsync(key: string): Promise<void> {
    remove(key);
  },
};

export function getSecureKv(): Promise<SecureKvApi> {
  clearLegacyPersistentValues();
  return Promise.resolve(webSecureKv);
}
