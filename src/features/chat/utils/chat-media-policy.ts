/**
 * 聊天图片的发送前体积上限。
 *
 * 与头像 / 圈子封面 / 好友照片 的既有 gate 保持同一个 10MB 上限，只是此前聊天发图这条
 * 路径漏了 —— 而它恰恰是全 App 上传量最大的入口。没有 gate 时，一张几十 MB 的原图会先
 * 整份传上去才被用户察觉，白烧流量与等待。
 */
export const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_CHAT_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_CHAT_VIDEO_DURATION_MS = 10 * 60 * 1000;

/**
 * fileSize 缺失时放行：部分相册资产不报体积，不能因为元数据缺失就拦掉正常发图。
 * （与 use-change-circle-avatar 等既有 gate 的 `asset.fileSize && ...` 判断同义。）
 */
export function isChatImageTooLarge(fileSize?: number | null): boolean {
  return typeof fileSize === 'number' && fileSize > MAX_CHAT_IMAGE_BYTES;
}

export function isChatVideoTooLarge(fileSize?: number | null): boolean {
  return typeof fileSize === 'number' && fileSize > MAX_CHAT_VIDEO_BYTES;
}

export function isChatVideoTooLong(durationMs?: number | null): boolean {
  return typeof durationMs === 'number' && durationMs > MAX_CHAT_VIDEO_DURATION_MS;
}
