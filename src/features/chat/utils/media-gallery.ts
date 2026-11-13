import * as FileSystem from 'expo-file-system/legacy';
import type { ImagePickerAsset } from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { Platform } from 'react-native';
import { reportHandledFailure } from '@/observability/report-failure';

/** send:选完直接发;edit:只选一张照片,确认后进照片编辑器。 */
export type MediaGalleryMode = 'send' | 'edit';

/**
 * all/limited:能浏览相册(limited = 用户只放开了部分照片);
 * denied:被拒绝,引导去设置或改用系统相册;unavailable:平台/安装包不支持,只能用系统相册。
 */
export type GalleryAccess = 'checking' | 'all' | 'limited' | 'denied' | 'unavailable';

export const GALLERY_PAGE_SIZE = 90;

export function galleryMediaTypes(mode: MediaGalleryMode): MediaLibrary.MediaTypeValue[] {
  return mode === 'edit'
    ? [MediaLibrary.MediaType.photo]
    : [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video];
}

function toGalleryAccess(permission: MediaLibrary.PermissionResponse): GalleryAccess {
  if (!permission.granted) return 'denied';
  return permission.accessPrivileges === 'limited' ? 'limited' : 'all';
}

/**
 * 只要读照片和视频(安卓 13+ 不申请音频)。已授权时不会再弹窗。
 * 旧安装包的安卓清单里没有 READ_MEDIA_IMAGES/VIDEO,请求会直接失败,由调用方降级到系统相册。
 */
export async function requestGalleryAccess(): Promise<GalleryAccess> {
  if (Platform.OS === 'web') return 'unavailable';
  return toGalleryAccess(await MediaLibrary.requestPermissionsAsync(false, ['photo', 'video']));
}

/** 从设置页回来时只查不弹窗。 */
export async function readGalleryAccess(): Promise<GalleryAccess> {
  if (Platform.OS === 'web') return 'unavailable';
  return toGalleryAccess(await MediaLibrary.getPermissionsAsync(false, ['photo', 'video']));
}

async function localFileUri(asset: MediaLibrary.Asset): Promise<string | undefined> {
  // 安卓的 asset.uri 本身就是 file:// 真实路径。不能走 getAssetInfoAsync:它在安卓 10+ 上会顺带
  // 读每张照片原图里的 EXIF 定位,而 app.json 有意不申请 ACCESS_MEDIA_LOCATION,照片会全部读取失败。
  if (Platform.OS === 'android') return asset.uri;
  // iOS 上 asset.uri 是 ph://,上传和压缩都要真实文件;只在 iCloud 上的会先下载下来。
  const info = await MediaLibrary.getAssetInfoAsync(asset, { shouldDownloadFromNetwork: true });
  // 个别 iOS 资源的 localUri 带 #fragment,文件名和类型推断都会被它带偏。
  return info.localUri?.split('#')[0];
}

async function resolveGalleryAsset(asset: MediaLibrary.Asset): Promise<ImagePickerAsset | null> {
  const uri = await localFileUri(asset);
  // 慢动作这类合成视频没有单一文件,拿不到就跳过。
  if (!uri) return null;
  const file = await FileSystem.getInfoAsync(uri);
  const isVideo = asset.mediaType === MediaLibrary.MediaType.video;
  return {
    assetId: asset.id,
    uri,
    width: asset.width,
    height: asset.height,
    type: isVideo ? 'video' : 'image',
    fileName: asset.filename,
    fileSize: file.exists ? file.size : undefined,
    // 发送管线沿用 expo-image-picker 的毫秒;相册给的是秒。
    duration: isVideo ? Math.round(asset.duration * 1000) : null,
  };
}

/**
 * 把选中的相册条目换成发送管线认识的本地文件,保持选择顺序。
 * 逐项独立:某一项读不到(iCloud 下载失败、选完之后被删了)只跳过它,其余照发。
 */
export async function resolveGalleryAssets(
  assets: readonly MediaLibrary.Asset[],
): Promise<ImagePickerAsset[]> {
  const resolved = await Promise.all(
    assets.map((asset) =>
      resolveGalleryAsset(asset).catch((error: unknown) => {
        reportHandledFailure('chatMediaPicker', 'resolveAsset', error);
        return null;
      }),
    ),
  );
  return resolved.filter((asset): asset is ImagePickerAsset => asset !== null);
}

export function formatGalleryDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes.toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
}
