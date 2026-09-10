/**
 * 聊天背景 uri 的判定与拆解。刻意不依赖任何原生模块 —— 偏好 store 在登出 teardown
 * 和聊天页都会被加载，不该因为一个纯字符串判断就把 expo-file-system /
 * expo-image-manipulator 拖进它的 import 图。
 */

/**
 * 原生端只存文件名，不存绝对路径。iOS 的 Data 容器 UUID 在重装/更新后会变，
 * 把 `file:///…/Application/<uuid>/Documents/…` 存进偏好，等于下一次重装壁纸就
 * 自己消失（图加载失败又是静默的，只剩一层蒙版）。绝对路径在渲染时现拼。
 */
export const CHAT_BACKGROUND_FILE_SCHEME = 'chat-bg:';

/** web 端没有可持久化的文件系统，只能把图本身存进偏好。 */
export const CHAT_BACKGROUND_DATA_URL_PREFIX = 'data:image/jpeg;base64,';

/** 背景图目录名，落在应用的 Documents 下。 */
export const CHAT_BACKGROUND_DIR_NAME = 'chat-backgrounds';

/**
 * 只有本机来源才是有效背景。历史上存过的 http(s) 直链一律当作未设置——它们指向
 * 一个已经不再匿名可读的对象（`chat/` 前缀不在公开读白名单里），留着只会画出
 * 一片蒙版灰。裸 `file://` 同样拒收，见 CHAT_BACKGROUND_FILE_SCHEME 的理由。
 */
export function isLocalChatBackgroundImageUri(uri: string | null | undefined) {
  if (typeof uri !== 'string' || !uri) return false;
  return (
    uri.startsWith(CHAT_BACKGROUND_FILE_SCHEME) ||
    uri.startsWith(CHAT_BACKGROUND_DATA_URL_PREFIX)
  );
}

/** 从 `chat-bg:<name>` 取回文件名；不是这个 scheme 就返回 null。 */
export function chatBackgroundFileName(uri: string | null | undefined) {
  if (typeof uri !== 'string') return null;
  if (!uri.startsWith(CHAT_BACKGROUND_FILE_SCHEME)) return null;
  const name = uri.slice(CHAT_BACKGROUND_FILE_SCHEME.length);
  // 只接受我们自己生成的扁平文件名，挡掉任何路径穿越。
  return /^[A-Za-z0-9._-]+$/.test(name) ? name : null;
}
