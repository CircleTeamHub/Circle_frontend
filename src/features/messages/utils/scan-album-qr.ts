import { scanFromURLAsync, type BarcodeScanningResult } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';
import type { ImagePickerAsset } from 'expo-image-picker';
import { Platform } from 'react-native';

async function scanImage(image: ImageRef): Promise<BarcodeScanningResult | undefined> {
  const file = await image.saveAsync({ format: SaveFormat.PNG });
  try {
    const [found] = await scanFromURLAsync(file.uri, ['qr']);
    return found;
  } finally {
    await FileSystem.deleteAsync(file.uri, { idempotent: true }).catch(() => undefined);
  }
}

/** Android's image scanner needs the QR to occupy most of the image, including on saved name cards. */
export async function scanQrFromAlbum(
  asset: Pick<ImagePickerAsset, 'uri' | 'width' | 'height'>,
): Promise<BarcodeScanningResult | undefined> {
  const [original] = await scanFromURLAsync(asset.uri, ['qr']);
  if (original || Platform.OS !== 'android') return original;

  // Normalize orientation/format and bound subsequent native bitmaps; keep the saved card intact.
  const context = ImageManipulator.manipulate(asset.uri);
  let image: ImageRef;
  try {
    if (Math.max(asset.width, asset.height) > 1600) {
      context.resize(asset.width >= asset.height ? { width: 1600 } : { height: 1600 });
    }
    image = await context.renderAsync();
  } finally {
    context.release();
  }

  try {
    const normalized = await scanImage(image);
    if (normalized) return normalized;

    // Overlapping crops cover the central code above/below the identity row without assuming a card size.
    const { width, height } = image;
    const side = Math.max(1, Math.floor(Math.min(width, height) * 0.9));
    const offsets = width === height ? [0.5] : [0.5, 0.75, 0.25];
    for (const offset of offsets) {
      const crop = ImageManipulator.manipulate(image);
      let cropped: ImageRef | undefined;
      try {
        crop.crop({
          originX: Math.floor((width - side) * (width > height ? offset : 0.5)),
          originY: Math.floor((height - side) * (height > width ? offset : 0.5)),
          width: side,
          height: side,
        }).resize({ width: 1024 });
        cropped = await crop.renderAsync();
        const found = await scanImage(cropped);
        if (found) return found;
      } finally {
        cropped?.release();
        crop.release();
      }
    }
    return undefined;
  } finally {
    image.release();
  }
}
