import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';

/**
 * 把一张网络图片存进系统相册（原生档）。
 *
 * 与 features/qr/save-qr-image 同款权限姿势：只申请「仅写入」
 * （iOS NSPhotoLibraryAddUsageDescription），不索要读取全库。
 * 差别是这里的源是 URL，先落缓存再入库，入库后即删临时文件。
 *
 * ⚠️ 与 save-image.web.ts 的导出面必须保持一致（Metro 按平台择档）。
 */
export type SaveImageResult = 'saved' | 'denied' | 'failed' | 'blocked';

/** 从 URL 猜扩展名；猜不到按 jpg（相册按内容识别，扩展名只影响文件名）。 */
function guessExtension(url: string): string {
  const path = url.split('?')[0];
  const match = /\.([a-z0-9]{3,4})$/i.exec(path);
  const ext = match?.[1]?.toLowerCase();
  return ext && ext.length <= 4 ? ext : 'jpg';
}

export async function saveImageToLibrary(
  url: string,
): Promise<SaveImageResult> {
  try {
    const permission = await MediaLibrary.requestPermissionsAsync(true);
    if (!permission.granted) return 'denied';

    const target = `${FileSystem.cacheDirectory}save-${Date.now()}.${guessExtension(url)}`;
    const download = await FileSystem.downloadAsync(url, target);
    if (download.status < 200 || download.status >= 300) return 'failed';

    try {
      await MediaLibrary.saveToLibraryAsync(download.uri);
    } finally {
      void FileSystem.deleteAsync(download.uri, { idempotent: true }).catch(
        () => undefined,
      );
    }
    return 'saved';
  } catch {
    return 'failed';
  }
}

/**
 * 两档导出面对齐用。原生直接写系统相册，不存在「拿不到字节只能开浏览器」
 * 那条路（saveImageToLibrary 在原生永远不会回 'blocked'），所以这里不做事。
 */
export function openImageInNewTab(_url: string): boolean {
  return false;
}
