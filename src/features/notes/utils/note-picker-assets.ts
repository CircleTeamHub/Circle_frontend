import { MAX_NOTE_MEDIA_SELECTION } from './note-media-upload';

type PickerAsset = { uri: string };

export function splitPickerAssets<T extends PickerAsset>(assets: readonly T[]) {
  return {
    selectedAssets: assets.slice(0, MAX_NOTE_MEDIA_SELECTION),
    overflowAssets: assets.slice(MAX_NOTE_MEDIA_SELECTION),
  };
}

function isOwnedWebPickerUri(uri: unknown): uri is string {
  return typeof uri === 'string' && uri.startsWith('blob:');
}

/** Picker-created object URLs only exist on web; never revoke native file URIs. */
export function revokeOwnedPickerPreview(uri: string | undefined) {
  if (
    typeof window !== 'undefined' &&
    isOwnedWebPickerUri(uri) &&
    typeof URL !== 'undefined' &&
    typeof URL.revokeObjectURL === 'function'
  ) {
    URL.revokeObjectURL(uri);
  }
}

export function revokeOwnedPickerPreviews(items: readonly PickerAsset[]) {
  items.forEach((item) => revokeOwnedPickerPreview(item.uri));
}

/** Tracks only picker-owned web object URLs so cleanup cannot revoke an active preview twice. */
export function createPickerPreviewDisposer() {
  const ownedUris = new Set<string>();

  const dispose = (uri: string | undefined) => {
    if (!isOwnedWebPickerUri(uri) || !ownedUris.delete(uri)) return;
    revokeOwnedPickerPreview(uri);
  };

  return {
    retain: (uri: string | undefined) => {
      if (isOwnedWebPickerUri(uri)) ownedUris.add(uri);
    },
    retainAssets: (assets: readonly PickerAsset[]) => {
      assets.forEach((asset) => {
        if (isOwnedWebPickerUri(asset.uri)) ownedUris.add(asset.uri);
      });
    },
    dispose,
    disposeAssets: (assets: readonly PickerAsset[]) => {
      assets.forEach((asset) => dispose(asset.uri));
    },
    disposeAll: () => {
      [...ownedUris].forEach(dispose);
    },
  };
}
