import type { MMKV } from 'react-native-mmkv';

/**
 * encrypted-init 的 Web 平台档（Metro 按平台择档；导出面与原生档保持一致，
 * tsc 两份都查 —— 那边加导出这边要同步补，见 local-db.web.ts 的同款约定）。
 *
 * 原生档是「SecureStore 密钥 + MMKV AES」。浏览器没有系统钥匙串，在
 * localStorage 里做对称加密等于把钥匙和密文放同一个抽屉，没有真实安全
 * 增益、只添损坏路径 —— 因此 Web 档直接用带前缀的 localStorage 明文存
 * 偏好/缓存（登录 token 的 Web 取舍另见 secure-kv.web.ts）。
 *
 * SSG（`expo export --platform web` 静态渲染）在 Node 里求值本模块：
 * 没有 window，所有读写落到进程内 Map，产物只是壳 HTML，不影响运行时。
 * 隐私模式/配额满时 localStorage 的单次操作也可能抛，同样退内存 ——
 * 至少本次会话内自洽，刷新后回到空库（等价于原生「壳回退模式」）。
 */

const PREFIX = 'circle-im.kv.';

const memoryFallback = new Map<string, string>();

function getLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    // 部分隐私模式下访问 localStorage 属性本身就会抛。
    return null;
  }
}

function readRaw(key: string): string | null {
  // 内存覆盖优先。它只在"持久化失败"时存在，代表比 localStorage 里那份**更新**
  // 的值 —— 反过来先读 localStorage，配额满之后会把旧值复活：写入报告成功、
  // 读回来却是上一版。与 secure-kv.web.ts 的 read() 同一套判断，两处要一起改。
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

function writeRaw(key: string, value: string): void {
  const ls = getLocalStorage();
  if (ls) {
    try {
      ls.setItem(PREFIX + key, value);
      // 落盘成功就撤掉内存覆盖，否则那份旧覆盖会一直遮住持久值。
      memoryFallback.delete(key);
      return;
    } catch {
      // 配额满/隐私模式：退内存，本次会话内保持一致。
    }
  }
  memoryFallback.set(key, value);
}

function removeRaw(key: string): void {
  const ls = getLocalStorage();
  if (ls) {
    try {
      ls.removeItem(PREFIX + key);
    } catch {
      // 删除失败只影响下次启动多读到一条旧值。
    }
  }
  memoryFallback.delete(key);
}

/**
 * MMKV 是分型读取（getString/getBoolean 各自返回 undefined 表示"不是这个
 * 类型"），localStorage 只有字符串 —— 用单字符类型标签保住这个语义。
 */
const webStore = {
  getString(key: string): string | undefined {
    const raw = readRaw(key);
    return raw !== null && raw.startsWith('s:') ? raw.slice(2) : undefined;
  },
  getBoolean(key: string): boolean | undefined {
    const raw = readRaw(key);
    if (raw === 'b:true') return true;
    if (raw === 'b:false') return false;
    return undefined;
  },
  getNumber(key: string): number | undefined {
    const raw = readRaw(key);
    if (raw === null || !raw.startsWith('n:')) return undefined;
    const parsed = Number(raw.slice(2));
    return Number.isNaN(parsed) ? undefined : parsed;
  },
  set(key: string, value: string | number | boolean): void {
    if (typeof value === 'boolean') {
      writeRaw(key, `b:${value}`);
    } else if (typeof value === 'number') {
      writeRaw(key, `n:${value}`);
    } else {
      writeRaw(key, `s:${value}`);
    }
  },
  remove(key: string): void {
    removeRaw(key);
  },
  contains(key: string): boolean {
    return readRaw(key) !== null;
  },
  clearAll(): void {
    const ls = getLocalStorage();
    if (ls) {
      try {
        const doomed: string[] = [];
        for (let i = 0; i < ls.length; i += 1) {
          const key = ls.key(i);
          if (key?.startsWith(PREFIX)) doomed.push(key);
        }
        for (const key of doomed) ls.removeItem(key);
      } catch {
        // 清不掉就留着，前缀隔离保证不影响其他同源应用。
      }
    }
    memoryFallback.clear();
  },
} as unknown as MMKV;

// Web 存储天生同步可用：实例即刻就位，启动门之前的读也直达（原生档的
// "init 前返回 null" 是 SecureStore 异步性所迫，这里没有那个约束）。
const instance: MMKV = webStore;

export function initEncryptedStorage(): Promise<MMKV> {
  return Promise.resolve(instance);
}

export function getEncryptedInstance(): MMKV | null {
  return instance;
}
