import type * as SecureStoreModule from 'expo-secure-store';

/**
 * SecureStore 平台间接层的 Web 档（导出面与 secure-kv.ts 保持一致）。
 *
 * 浏览器没有系统钥匙串。登录 token 落带前缀的 localStorage —— 这是桌面
 * 网页版评估时明确接受的取舍（测试期）：XSS 防线靠同源部署与后端 CSP，
 * 后续要收紧再引入 cookie 通道。expo-secure-store 在 web 上没有实现，
 * 若不换档，所有凭证写入都会静默失败、刷新即掉登录。
 *
 * SSG（expo export 静态渲染）在 Node 里求值：无 window 时读写落进程内
 * Map，导出产物不含任何 token。隐私模式/配额满的单次操作失败同样退内存，
 * 本次会话内自洽。
 */
export type SecureKvApi = Pick<
  typeof SecureStoreModule,
  | 'getItemAsync'
  | 'setItemAsync'
  | 'deleteItemAsync'
  | 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY'
>;

const PREFIX = 'circle-im.sec.';

const memoryFallback = new Map<string, string>();

function getLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  // 内存覆盖优先。它只在"持久化失败"时存在，代表比 localStorage 里那份**更新**
  // 的值 —— 反过来先读 localStorage，会在配额满之后把上一个账号的 token 复活：
  // 写入报告成功、读回来却是旧凭证，表现为切号后仍以旧身份登录或直接鉴权失败。
  const override = memoryFallback.get(key);
  if (override !== undefined) return override;

  const ls = getLocalStorage();
  if (ls) {
    try {
      const value = ls.getItem(PREFIX + key);
      if (value !== null) return value;
    } catch {
      // 读失败：没有覆盖可用，只能当作空。
    }
  }
  return null;
}

function write(key: string, value: string): void {
  const ls = getLocalStorage();
  if (ls) {
    try {
      ls.setItem(PREFIX + key, value);
      // 落盘成功就撤掉内存覆盖，否则那份旧覆盖会一直遮住持久值。
      memoryFallback.delete(key);
      return;
    } catch {
      // 配额满/隐私模式：退内存，本次会话内保持登录。
    }
  }
  memoryFallback.set(key, value);
}

function remove(key: string): void {
  const ls = getLocalStorage();
  if (ls) {
    try {
      ls.removeItem(PREFIX + key);
    } catch {
      // 删除失败最多让下次启动多读到一条旧凭证，随后会被覆盖。
    }
  }
  memoryFallback.delete(key);
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
  return Promise.resolve(webSecureKv);
}
