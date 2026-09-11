import { normalizeChatBackgroundImage } from '@/features/chat/utils/chat-background-normalize';
import {
  CHAT_BACKGROUND_DIR_NAME,
  CHAT_BACKGROUND_FILE_SCHEME,
  chatBackgroundFileName,
  newChatBackgroundFileName,
} from '@/features/chat/utils/chat-background-uri';

/**
 * 聊天背景图的 Web 档（导出面与 chat-background-image.ts 一致）。
 *
 * 浏览器没有可持久化的应用目录，但也**不能**把图本身塞进偏好：persist 落的是
 * localStorage，配额只有 ~5MB，一张 1440px 的 JPEG 就能占掉小半，设三四个背景就
 * QuotaExceeded —— 那一刻整份 `circle-im-chat-preferences` 写不进去（连带预设、
 * 每会话设置一起），而 zustand 的写失败是静默的，刷新后用户看到的是所有聊天偏好
 * 凭空消失。
 *
 * 所以这里和原生端保持同一套语义：偏好里只存 `chat-bg:<name>`，图片本体（JPEG
 * blob）落 IndexedDB —— 它按名字取、有独立的大配额、不参与每次 setState 的全量
 * 重写。渲染时才换成 object URL，并按名字记住，替换/清理时 revoke。
 *
 * SSG（expo export 静态渲染）在 Node 里求值，没有 indexedDB：读取一律退成「没有
 * 背景」，写入抛错由调用方（ChatBackgroundScreen）的失败提示兜住。
 */

const DB_NAME = `circle-im-${CHAT_BACKGROUND_DIR_NAME}`;
const DB_VERSION = 1;
const STORE_NAME = 'images';

/** name → object URL。同一张图只建一个 URL，删掉时才 revoke。 */
const objectUrls = new Map<string, string>();

let databasePromise: Promise<IDBDatabase> | null = null;

function getIndexedDb(): IDBFactory | null {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB;
  } catch {
    // 个别浏览器在禁用站点数据时读 indexedDB 本身就抛。
    return null;
  }
}

function openDatabase(): Promise<IDBDatabase> {
  const factory = getIndexedDb();
  if (!factory) {
    return Promise.reject(new Error('chat background: IndexedDB unavailable'));
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('chat background: cannot open IndexedDB'));
    request.onblocked = () =>
      reject(new Error('chat background: IndexedDB upgrade blocked'));
  });
}

function database(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = openDatabase().catch((err) => {
      // 打不开就别把失败缓存成永久状态，下次再试。
      databasePromise = null;
      throw err;
    });
  }
  return databasePromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = run(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('chat background: IndexedDB request failed'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('chat background: IndexedDB aborted'));
  });
}

function revokeObjectUrl(name: string) {
  const url = objectUrls.get(name);
  if (!url) return;
  objectUrls.delete(name);
  try {
    URL.revokeObjectURL(url);
  } catch {
    // 没有 URL.revokeObjectURL 的环境（SSG）里本来也建不出 object URL。
  }
}

/**
 * manipulator 在 web 上把结果交成一个 blob: URL。取回字节后立刻 revoke，否则整张
 * JPEG 会跟着这一页活到标签关闭。
 */
async function readNormalizedBlob(uri: string): Promise<Blob> {
  try {
    const response = await fetch(uri);
    return await response.blob();
  } finally {
    try {
      URL.revokeObjectURL(uri);
    } catch {
      // 不是 object URL 时本就是 no-op。
    }
  }
}

/**
 * 把存下来的偏好换成 <ImageBackground> 能直接吃的 source uri。web 端要先从
 * IndexedDB 取回 blob，所以和原生档一样是异步的。
 */
export async function resolveChatBackgroundImageSource(
  stored: string | null | undefined,
): Promise<string | null> {
  const name = chatBackgroundFileName(stored);
  if (!name) return null;

  const cached = objectUrls.get(name);
  if (cached) return cached;

  try {
    const blob = await withStore<Blob | undefined>('readonly', (store) =>
      store.get(name),
    );
    if (!blob) return null;
    // 并发解析同一个名字时保留先落位的那个 URL：另一个视图可能已经在用它了。
    const existing = objectUrls.get(name);
    if (existing) return existing;

    const url = URL.createObjectURL(blob);
    objectUrls.set(name, url);
    return url;
  } catch {
    // 取不到就当没设置背景，退回主题底色 —— 画一层蒙版灰才是这个 PR 要修的 bug。
    return null;
  }
}

/** 把用户选的图收进 IndexedDB，返回要存进偏好的值。 */
export async function persistChatBackgroundImage(
  sourceUri: string,
  sourceWidth?: number,
): Promise<string> {
  const normalized = await normalizeChatBackgroundImage(sourceUri, sourceWidth);
  const blob = await readNormalizedBlob(normalized.uri);

  const name = newChatBackgroundFileName();
  await withStore('readwrite', (store) => store.put(blob, name));
  return `${CHAT_BACKGROUND_FILE_SCHEME}${name}`;
}

/**
 * 删掉库里没人再引用的背景图（与原生档遍历 Documents 子目录等价）。换背景和登出
 * 都会调；失败一律吞掉——清理不成功最多留下一个孤儿 blob。
 */
export async function pruneChatBackgroundImages(
  referencedUris: readonly string[],
): Promise<void> {
  try {
    const keep = new Set(
      referencedUris
        .map(chatBackgroundFileName)
        .filter((name): name is string => Boolean(name)),
    );
    const keys = await withStore<IDBValidKey[]>('readonly', (store) =>
      store.getAllKeys(),
    );

    for (const key of keys) {
      if (typeof key !== 'string' || keep.has(key)) continue;
      try {
        await withStore('readwrite', (store) => store.delete(key));
        revokeObjectUrl(key);
      } catch {
        // 单个 blob 删不掉不影响其余清理。
      }
    }
  } catch {
    // 库打不开 / 无权限：没有需要清理的东西。
  }
}
