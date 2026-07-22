/**
 * im/data-dir.ts — OpenIM 本地数据目录的唯一权威定义
 *
 * 这个路径不是 SDK 选的：app 自己算出来传给 OpenIMSDK.initSDK({ dataDir })。
 * 它曾在 im/client.ts 与 services/cache/clear-app-cache.ts 各写一份字面量，
 * 任一处改名都会让「聊天占用空间」统计静默归零（#114）—— 共享常量堵死这条路。
 * 零依赖纯模块：两个消费方都能 import，不引入模块环。
 */
export const OPENIM_DATA_DIR_NAME = 'openim';

export function getOpenIMDataDirPath(documentDirectoryPath: string): string {
  return `${documentDirectoryPath}/${OPENIM_DATA_DIR_NAME}`;
}
