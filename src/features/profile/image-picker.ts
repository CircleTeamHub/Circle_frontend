import type * as ExpoImagePicker from 'expo-image-picker';

type ImagePickerModule = typeof ExpoImagePicker;

export function loadImagePickerModule(): ImagePickerModule | null {
  try {
    return require('expo-image-picker') as ImagePickerModule;
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
      return null;
    }

    throw error;
  }
}
