import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';

/**
 * 把二维码 PNG(base64,来自 react-native-qrcode-svg 的 toDataURL)存进系统相册。
 * 只申请「仅写入」权限(iOS NSPhotoLibraryAddUsageDescription),不索要读取全库。
 */
export async function saveQrPngToLibrary(
  base64: string,
): Promise<'saved' | 'denied'> {
  const permission = await MediaLibrary.requestPermissionsAsync(true);
  if (!permission.granted) return 'denied';

  const uri = `${FileSystem.cacheDirectory}qr-share-${Date.now()}.png`;
  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  try {
    await MediaLibrary.saveToLibraryAsync(uri);
  } finally {
    // 相册已持有副本,缓存里的临时文件即删;删失败无所谓(缓存清理兜底)。
    void FileSystem.deleteAsync(uri, { idempotent: true }).catch(
      () => undefined,
    );
  }
  return 'saved';
}
