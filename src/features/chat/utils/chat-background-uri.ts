/**
 * 聊天背景 uri 的生成、判定与拆解。刻意不依赖任何模块 —— 偏好 store 在登出
 * teardown 和聊天页都会被加载，不该因为一个纯字符串判断就把 expo-file-system /
 * expo-image-manipulator 拖进它的 import 图。
 */

/**
 * 偏好里只存文件名，不存绝对路径，也不存图片本身。
 *
 * - 原生：iOS 的 Data 容器 UUID 在重装/更新后会变，把
 *   `file:///…/Application/<uuid>/Documents/…` 存进偏好，等于下一次重装壁纸就
 *   自己消失（图加载失败又是静默的，只剩一层蒙版）。绝对路径在渲染时现拼。
 * - web：图片本体落 IndexedDB，同样按这个名字取。把 data: URL 塞进持久化的
 *   zustand state 会吃光 localStorage 的 ~5MB 配额，之后所有聊天偏好（含预设）
 *   一起静默丢失。
 */
export const CHAT_BACKGROUND_FILE_SCHEME = 'chat-bg:';

/** 背景图的存放位置名：原生是 Documents 下的子目录，web 是 IndexedDB 库名的后缀。 */
export const CHAT_BACKGROUND_DIR_NAME = 'chat-backgrounds';

/**
 * 新背景图的文件名。每次选图都换一个名字：旧名字还被没来得及重渲染的视图引用
 * （web 上还挂着一个 object URL），原地覆盖会让它们读到半张图。
 */
export function newChatBackgroundFileName() {
  return `bg-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
}

/** 从 `chat-bg:<name>` 取回文件名；不是这个 scheme 或名字不合法就返回 null。 */
export function chatBackgroundFileName(uri: string | null | undefined) {
  if (typeof uri !== 'string') return null;
  if (!uri.startsWith(CHAT_BACKGROUND_FILE_SCHEME)) return null;
  const name = uri.slice(CHAT_BACKGROUND_FILE_SCHEME.length);
  // 只接受我们自己生成的扁平文件名，挡掉任何路径穿越。
  return /^[A-Za-z0-9._-]+$/.test(name) ? name : null;
}

/**
 * 只有本机来源才是有效背景。历史上存过的 http(s) 直链一律当作未设置——它们指向
 * 一个已经不再匿名可读的对象（`chat/` 前缀不在公开读白名单里），留着只会画出
 * 一片蒙版灰。裸 `file://` 与 data: URL 同样拒收，见 CHAT_BACKGROUND_FILE_SCHEME。
 */
export function isLocalChatBackgroundImageUri(uri: string | null | undefined) {
  return chatBackgroundFileName(uri) !== null;
}
