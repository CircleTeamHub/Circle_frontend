import type * as ExpoImagePicker from 'expo-image-picker';

type ImagePickerModule = typeof ExpoImagePicker;

let cachedImagePickerModule: ImagePickerModule | null | undefined;

export function loadImagePickerModule(): ImagePickerModule | null {
  if (cachedImagePickerModule !== undefined) {
    return cachedImagePickerModule;
  }

  try {
    // Lazy sync load lets callers handle missing native modules in Expo Go/tests.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedImagePickerModule = require('expo-image-picker') as ImagePickerModule;
    return cachedImagePickerModule;
  } catch (error) {
    const message =
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      typeof error.message === 'string'
        ? error.message
        : null;

    if (
      message?.includes("Cannot find native module 'ExponentImagePicker'")
    ) {
      cachedImagePickerModule = null;
      return null;
    }

    throw error;
  }
}

type LaunchImageLibraryOptions = Parameters<ImagePickerModule['launchImageLibraryAsync']>[0];
type LaunchImageLibraryResult = Awaited<ReturnType<ImagePickerModule['launchImageLibraryAsync']>>;

export type FastImageLibraryOutcome =
  | { status: 'picked'; result: LaunchImageLibraryResult }
  | {
      status: 'denied';
      permission: Awaited<ReturnType<ImagePickerModule['requestMediaLibraryPermissionsAsync']>>;
    };

/**
 * 直接唤起系统相册，只有它明确失败时才走权限兜底。
 *
 * 点击后先 get/request 权限，会把原生权限桥接的延迟叠加到呈现动画上，部分 iOS
 * 设备要等好几秒才看到相册；iOS PHPicker / Android Photo Picker 本身不需要相册
 * 权限。调用方同样不要开 allowsEditing：iOS 上它会从秒开的 PHPicker 回退到老的
 * UIImagePickerController。
 *
 * 失败时先查当前权限:已授权说明失败与权限无关(读文件/转码失败等),原样上抛,
 * 不重新弹出相册;未授权才请求权限并重试一次。权限请求或重试本身的错误同样上抛,
 * 由调用方按各自的错误路径处理。
 */
export async function launchImageLibraryFast(
  imagePicker: Pick<
    ImagePickerModule,
    | 'launchImageLibraryAsync'
    | 'getMediaLibraryPermissionsAsync'
    | 'requestMediaLibraryPermissionsAsync'
  >,
  options: LaunchImageLibraryOptions,
): Promise<FastImageLibraryOutcome> {
  try {
    return { status: 'picked', result: await imagePicker.launchImageLibraryAsync(options) };
  } catch (launchError) {
    const current = await imagePicker.getMediaLibraryPermissionsAsync();
    if (current.granted) throw launchError;
    const permission = await imagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return { status: 'denied', permission };
    return { status: 'picked', result: await imagePicker.launchImageLibraryAsync(options) };
  }
}
