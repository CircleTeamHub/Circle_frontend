import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

/** 聊天图片上传前的长边上限:手机屏幕全屏查看、双指放大都够用。 */
export const CHAT_IMAGE_MAX_EDGE = 2048;
export const CHAT_IMAGE_JPEG_QUALITY = 0.82;

export interface ChatImageSource {
  uri: string;
  width?: number;
  height?: number;
  contentType: string;
  filename: string;
}

export interface PreparedChatImage {
  uri: string;
  width?: number;
  height?: number;
  contentType: string;
  filename: string;
}

type ResizeTarget = { width: number } | { height: number };

export type ChatImageUploadPlan =
  | { reencode: false }
  | { reencode: true; resize: ResizeTarget | null };

function positive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function resizeTargetFor(width: number, height: number): ResizeTarget | null {
  if (Math.max(width, height) <= CHAT_IMAGE_MAX_EDGE) return null;
  return width >= height
    ? { width: CHAT_IMAGE_MAX_EDGE }
    : { height: CHAT_IMAGE_MAX_EDGE };
}

/**
 * 一张图怎么发。
 *
 * 原来是原图直传:手机相机一张 4000×3000 起步、几 MB,对方在聊天里看根本用不上,
 * 双方白白多花流量和等待;原图里的 EXIF(拍摄地点的 GPS)也一并发给了对方。
 * 现在除 GIF(重新编码会丢掉动画)外一律重新编码成 JPEG,长边超过 2048 的先缩小。
 * 尺寸不知道时先不缩放地编码一遍拿到尺寸,超了再缩(见 prepareChatImageForUpload)。
 */
export function planChatImageUpload(source: ChatImageSource): ChatImageUploadPlan {
  if (source.contentType === 'image/gif') return { reencode: false };
  if (positive(source.width) && positive(source.height)) {
    return { reencode: true, resize: resizeTargetFor(source.width, source.height) };
  }
  return { reencode: true, resize: null };
}

function jpegFilename(filename: string): string {
  const base = filename.replace(/\.[^./]*$/, '');
  return `${base || 'image'}.jpg`;
}

/**
 * 按 planChatImageUpload 处理好要上传的文件。处理失败就发原图:压缩是锦上添花,
 * 不能因为它发不出去。
 */
export async function prepareChatImageForUpload(
  source: ChatImageSource,
): Promise<PreparedChatImage> {
  const plan = planChatImageUpload(source);
  if (!plan.reencode) return { ...source };
  const saveOptions = {
    compress: CHAT_IMAGE_JPEG_QUALITY,
    format: SaveFormat.JPEG,
  };
  try {
    let result = await manipulateAsync(
      source.uri,
      plan.resize ? [{ resize: plan.resize }] : [],
      saveOptions,
    );
    const lateResize = plan.resize
      ? null
      : resizeTargetFor(result.width, result.height);
    if (lateResize) {
      result = await manipulateAsync(
        source.uri,
        [{ resize: lateResize }],
        saveOptions,
      );
    }
    return {
      uri: result.uri,
      width: result.width,
      height: result.height,
      contentType: 'image/jpeg',
      filename: jpegFilename(source.filename),
    };
  } catch {
    return { ...source };
  }
}
