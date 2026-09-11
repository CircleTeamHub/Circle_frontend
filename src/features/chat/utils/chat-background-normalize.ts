import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import type { ImageResult } from 'expo-image-manipulator';

/**
 * 把用户选的图统一成 JPEG，并只在需要时降采样。两个平台档共用这一步；落盘
 * （原生 Documents / web IndexedDB）由各自的档负责，这里只管像素。
 */

// 背景是全屏铺底，超过这个宽度对观感没有增益，只会白白占磁盘和解码内存。
const MAX_CHAT_BACKGROUND_WIDTH = 1440;
const CHAT_BACKGROUND_QUALITY = 0.85;

/**
 * 只下采样，绝不上采样。
 *
 * manipulator 拿到一个 width 就会等比缩放到那个宽度——对比 1440 窄的图等于放大：
 * 更糊、更占地方。picker 报不出宽度时给的是 0（见 ImagePickerAsset.width 的文档），
 * 此时宁可原样收下也不拿一个猜的宽度去重采样：多占点磁盘是可逆的，把用户的
 * 壁纸糊掉不是。
 */
export async function normalizeChatBackgroundImage(
  sourceUri: string,
  sourceWidth?: number,
): Promise<ImageResult> {
  const needsDownsample =
    typeof sourceWidth === 'number' && sourceWidth > MAX_CHAT_BACKGROUND_WIDTH;

  return manipulateAsync(
    sourceUri,
    needsDownsample ? [{ resize: { width: MAX_CHAT_BACKGROUND_WIDTH } }] : [],
    { compress: CHAT_BACKGROUND_QUALITY, format: SaveFormat.JPEG },
  );
}
