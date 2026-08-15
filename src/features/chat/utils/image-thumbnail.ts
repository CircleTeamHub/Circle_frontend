import {
  manipulateAsync,
  SaveFormat,
  type ImageResult,
} from 'expo-image-manipulator';
import {
  requestUploadPresign,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';

const THUMB_MAX_WIDTH = 512;

/**
 * 为聊天图片生成一张缩略图（宽 ≤ 512），用于消息列表气泡快速显示，避免列表滚动时
 * 逐张下载 + 解码全尺寸原图（内存 / 流量 / 卡顿）。原图仅在点开大图时才加载。
 *
 * 原图本身已足够小、或缩略生成失败时返回 null —— 调用方退化为「用原图当缩略图」，
 * 保持现有行为，绝不因缩略失败阻断发送。
 */
export async function generateChatImageThumbnail(
  uri: string,
  originalWidth?: number,
): Promise<ImageResult | null> {
  if (originalWidth && originalWidth <= THUMB_MAX_WIDTH) {
    return null;
  }

  try {
    return await manipulateAsync(uri, [{ resize: { width: THUMB_MAX_WIDTH } }], {
      compress: 0.6,
      format: SaveFormat.JPEG,
    });
  } catch {
    return null;
  }
}

export async function uploadChatImageThumbnail(
  uri: string,
  originalWidth: number | undefined,
  filename: string,
): Promise<{ url: string; key: string; width: number; height: number } | null> {
  try {
    const thumbnail = await generateChatImageThumbnail(uri, originalWidth);
    if (!thumbnail) return null;

    const presign = await requestUploadPresign({
      filename: sanitizeUploadFilename(`thumb-${filename}`),
      contentType: 'image/jpeg',
      folder: 'chat',
      fileUri: thumbnail.uri,
    });
    await uploadLocalFileToPresignedUrl(
      presign.uploadUrl,
      'image/jpeg',
      thumbnail.uri,
      presign.requiredHeaders,
    );
    return {
      url: presign.fileUrl,
      // 自研聊天消息体只存 object key(读时签 URL);url 留给仍在用直链的调用方。
      key: presign.key,
      width: thumbnail.width,
      height: thumbnail.height,
    };
  } catch {
    return null;
  }
}
