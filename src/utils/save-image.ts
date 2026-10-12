import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';

/**
 * 把一份网络媒体存进系统相册（原生档）。
 *
 * 与 features/qr/save-qr-image 同款权限姿势：只申请「仅写入」
 * （iOS NSPhotoLibraryAddUsageDescription），不索要读取全库。
 * 差别是这里的源是 URL，先落缓存再入库，入库后即删临时文件。
 *
 * ⚠️ 与 save-image.web.ts 的导出面必须保持一致（Metro 按平台择档）。
 */
export type SaveImageResult = 'saved' | 'denied' | 'failed';

export type CachedMedia = {
  uri: string;
  cleanup: () => void | Promise<void>;
};

/** 从 URL / MIME 猜扩展名；相册按内容识别，扩展名只影响临时文件类型。 */
function guessExtension(url: string, mimeType?: string): string {
  const path = url.split('?')[0];
  const match = /\.([a-z0-9]{3,4})$/i.exec(path);
  const ext = match?.[1]?.toLowerCase();
  if (ext && ext.length <= 4) return ext;
  const mimeExtension = mimeType?.split('/')[1]?.split(';')[0]?.toLowerCase();
  if (mimeExtension === 'quicktime') return 'mov';
  if (mimeExtension && /^[a-z0-9]{2,5}$/.test(mimeExtension)) {
    return mimeExtension;
  }
  return 'jpg';
}

export async function downloadMediaToCache(
  url: string,
  options?: { mimeType?: string },
): Promise<CachedMedia | null> {
  try {
    const target = `${FileSystem.cacheDirectory}save-${Date.now()}.${guessExtension(
      url,
      options?.mimeType,
    )}`;
    const download = await FileSystem.downloadAsync(url, target);
    if (download.status < 200 || download.status >= 300) return null;
    return {
      uri: download.uri,
      cleanup: () =>
        FileSystem.deleteAsync(download.uri, { idempotent: true }).catch(
          () => undefined,
        ),
    };
  } catch {
    return null;
  }
}

export async function saveMediaToLibrary(
  url: string,
  options?: { mimeType?: string },
): Promise<SaveImageResult> {
  try {
    const permission = await MediaLibrary.requestPermissionsAsync(true);
    if (!permission.granted) return 'denied';

    const cached = await downloadMediaToCache(url, options);
    if (!cached) return 'failed';

    try {
      await MediaLibrary.saveToLibraryAsync(cached.uri);
    } finally {
      void cached.cleanup();
    }
    return 'saved';
  } catch {
    return 'failed';
  }
}

/** Compatibility name used by image viewer callers. The same path also supports videos. */
export const saveImageToLibrary = saveMediaToLibrary;
