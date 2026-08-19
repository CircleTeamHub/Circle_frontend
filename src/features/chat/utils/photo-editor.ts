export interface PhotoCropRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export interface DisplayCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CropResizeHandle =
  | 'topLeft'
  | 'topRight'
  | 'bottomLeft'
  | 'bottomRight';

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** contentFit="contain" 下照片在预览容器里的真实显示范围。 */
export function getContainedPhotoBounds(
  containerWidth: number,
  containerHeight: number,
  photoWidth: number,
  photoHeight: number,
): DisplayCropRect | null {
  if (
    ![containerWidth, containerHeight, photoWidth, photoHeight].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  ) {
    return null;
  }

  const scale = Math.min(containerWidth / photoWidth, containerHeight / photoHeight);
  const width = photoWidth * scale;
  const height = photoHeight * scale;
  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height,
  };
}

/** 把屏幕上的自由裁剪框转换成 ImageManipulator 使用的原图像素。 */
export function mapDisplayCropToPhotoPixels(
  crop: DisplayCropRect,
  photoBounds: DisplayCropRect,
  photoWidth: number,
  photoHeight: number,
): PhotoCropRect | null {
  if (
    ![photoWidth, photoHeight, photoBounds.width, photoBounds.height].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  ) {
    return null;
  }

  const boundsRight = photoBounds.x + photoBounds.width;
  const boundsBottom = photoBounds.y + photoBounds.height;
  const left = clamp(crop.x, photoBounds.x, boundsRight);
  const top = clamp(crop.y, photoBounds.y, boundsBottom);
  const right = clamp(crop.x + crop.width, left, boundsRight);
  const bottom = clamp(crop.y + crop.height, top, boundsBottom);
  if (right <= left || bottom <= top) return null;

  const scaleX = photoWidth / photoBounds.width;
  const scaleY = photoHeight / photoBounds.height;
  const originX = clamp(
    Math.round((left - photoBounds.x) * scaleX),
    0,
    Math.max(0, Math.floor(photoWidth) - 1),
  );
  const originY = clamp(
    Math.round((top - photoBounds.y) * scaleY),
    0,
    Math.max(0, Math.floor(photoHeight) - 1),
  );
  const width = clamp(
    Math.round((right - left) * scaleX),
    1,
    Math.floor(photoWidth) - originX,
  );
  const height = clamp(
    Math.round((bottom - top) * scaleY),
    1,
    Math.floor(photoHeight) - originY,
  );

  return { originX, originY, width, height };
}

export function moveDisplayCrop(
  crop: DisplayCropRect,
  dx: number,
  dy: number,
  bounds: DisplayCropRect,
): DisplayCropRect {
  return {
    ...crop,
    x: clamp(crop.x + dx, bounds.x, bounds.x + bounds.width - crop.width),
    y: clamp(crop.y + dy, bounds.y, bounds.y + bounds.height - crop.height),
  };
}

export function resizeDisplayCrop(
  crop: DisplayCropRect,
  handle: CropResizeHandle,
  dx: number,
  dy: number,
  bounds: DisplayCropRect,
  requestedMinSize: number,
): DisplayCropRect {
  const minWidth = Math.min(requestedMinSize, bounds.width);
  const minHeight = Math.min(requestedMinSize, bounds.height);
  let left = crop.x;
  let top = crop.y;
  let right = crop.x + crop.width;
  let bottom = crop.y + crop.height;

  if (handle === 'topLeft' || handle === 'bottomLeft') {
    left = clamp(crop.x + dx, bounds.x, right - minWidth);
  } else {
    right = clamp(crop.x + crop.width + dx, left + minWidth, bounds.x + bounds.width);
  }

  if (handle === 'topLeft' || handle === 'topRight') {
    top = clamp(crop.y + dy, bounds.y, bottom - minHeight);
  } else {
    bottom = clamp(
      crop.y + crop.height + dy,
      top + minHeight,
      bounds.y + bounds.height,
    );
  }

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}
