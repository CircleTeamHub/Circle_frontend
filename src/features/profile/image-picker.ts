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
