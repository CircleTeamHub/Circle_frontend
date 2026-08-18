import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Image } from 'expo-image';
import type { ImagePickerAsset } from 'expo-image-picker';
import {
  getContainedPhotoBounds,
  mapDisplayCropToPhotoPixels,
  moveDisplayCrop,
  resizeDisplayCrop,
  type CropResizeHandle,
  type DisplayCropRect,
  type PhotoCropRect,
} from '@/features/chat/utils/photo-editor';

interface FreePhotoCropperProps {
  asset: ImagePickerAsset;
  onCropChange: (crop: PhotoCropRect | null) => void;
  accessibilityLabel: string;
}

type GestureMode = 'move' | CropResizeHandle;

const MIN_CROP_SIZE = 72;
const HANDLE_TOUCH_SIZE = 40;

const s = StyleSheet.create({
  root: { flex: 1, width: '100%', height: '100%', overflow: 'hidden' },
  image: { ...StyleSheet.absoluteFillObject },
  shade: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.58)',
  },
  cropFrame: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  gridVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.52)',
  },
  gridHorizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.52)',
  },
  handle: {
    position: 'absolute',
    width: HANDLE_TOUCH_SIZE,
    height: HANDLE_TOUCH_SIZE,
  },
  cornerMark: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderColor: '#FFFFFF',
  },
});

export function FreePhotoCropper({
  asset,
  onCropChange,
  accessibilityLabel,
}: FreePhotoCropperProps) {
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const bounds = useMemo(
    () =>
      getContainedPhotoBounds(
        containerSize.width,
        containerSize.height,
        asset.width,
        asset.height,
      ),
    [asset.height, asset.width, containerSize.height, containerSize.width],
  );
  const [cropRect, setCropRect] = useState<DisplayCropRect | null>(null);
  const cropRectRef = useRef<DisplayCropRect | null>(null);
  const gestureStartRef = useRef<DisplayCropRect | null>(null);

  const publishCrop = useCallback(
    (rect: DisplayCropRect | null) => {
      onCropChange(
        rect && bounds
          ? mapDisplayCropToPhotoPixels(rect, bounds, asset.width, asset.height)
          : null,
      );
    },
    [asset.height, asset.width, bounds, onCropChange],
  );

  useEffect(() => {
    if (!bounds) {
      cropRectRef.current = null;
      setCropRect(null);
      onCropChange(null);
      return;
    }
    // 默认保留完整照片；四角触点放在框内侧，所以贴边时仍然容易拖动。
    const initial = { ...bounds };
    cropRectRef.current = initial;
    setCropRect(initial);
    onCropChange(
      mapDisplayCropToPhotoPixels(initial, bounds, asset.width, asset.height),
    );
  }, [asset.height, asset.uri, asset.width, bounds, onCropChange]);

  const updateDuringGesture = useCallback((rect: DisplayCropRect) => {
    cropRectRef.current = rect;
    setCropRect(rect);
  }, []);

  const createResponder = useCallback(
    (mode: GestureMode) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          gestureStartRef.current = cropRectRef.current;
        },
        onPanResponderMove: (_event, gesture) => {
          const start = gestureStartRef.current;
          if (!start || !bounds) return;
          updateDuringGesture(
            mode === 'move'
              ? moveDisplayCrop(start, gesture.dx, gesture.dy, bounds)
              : resizeDisplayCrop(
                  start,
                  mode,
                  gesture.dx,
                  gesture.dy,
                  bounds,
                  MIN_CROP_SIZE,
                ),
          );
        },
        onPanResponderRelease: () => publishCrop(cropRectRef.current),
        onPanResponderTerminate: () => publishCrop(cropRectRef.current),
      }),
    [bounds, publishCrop, updateDuringGesture],
  );

  const moveResponder = useMemo(() => createResponder('move'), [createResponder]);
  const topLeftResponder = useMemo(
    () => createResponder('topLeft'),
    [createResponder],
  );
  const topRightResponder = useMemo(
    () => createResponder('topRight'),
    [createResponder],
  );
  const bottomLeftResponder = useMemo(
    () => createResponder('bottomLeft'),
    [createResponder],
  );
  const bottomRightResponder = useMemo(
    () => createResponder('bottomRight'),
    [createResponder],
  );

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setContainerSize((current) =>
      current.width === width && current.height === height
        ? current
        : { width, height },
    );
  }, []);

  return (
    <View testID="free-photo-cropper" style={s.root} onLayout={handleLayout}>
      <Image
        source={{ uri: asset.uri }}
        style={s.image}
        contentFit="contain"
        accessibilityLabel={accessibilityLabel}
      />
      {cropRect && bounds ? (
        <>
          <View
            pointerEvents="none"
            style={[s.shade, { left: 0, right: 0, top: 0, height: cropRect.y }]}
          />
          <View
            pointerEvents="none"
            style={[
              s.shade,
              {
                left: 0,
                right: 0,
                top: cropRect.y + cropRect.height,
                bottom: 0,
              },
            ]}
          />
          <View
            pointerEvents="none"
            style={[
              s.shade,
              {
                left: 0,
                top: cropRect.y,
                width: cropRect.x,
                height: cropRect.height,
              },
            ]}
          />
          <View
            pointerEvents="none"
            style={[
              s.shade,
              {
                left: cropRect.x + cropRect.width,
                right: 0,
                top: cropRect.y,
                height: cropRect.height,
              },
            ]}
          />

          <View
            testID="free-crop-frame"
            style={[
              s.cropFrame,
              {
                left: cropRect.x,
                top: cropRect.y,
                width: cropRect.width,
                height: cropRect.height,
              },
            ]}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={accessibilityLabel}
            {...moveResponder.panHandlers}
          >
            <View style={[s.gridVertical, { left: '33.333%' }]} />
            <View style={[s.gridVertical, { left: '66.666%' }]} />
            <View style={[s.gridHorizontal, { top: '33.333%' }]} />
            <View style={[s.gridHorizontal, { top: '66.666%' }]} />
          </View>

          <View
            testID="free-crop-top-left"
            style={[s.handle, { left: cropRect.x, top: cropRect.y }]}
            {...topLeftResponder.panHandlers}
          >
            <View
              style={[
                s.cornerMark,
                { left: 0, top: 0, borderLeftWidth: 4, borderTopWidth: 4 },
              ]}
            />
          </View>
          <View
            testID="free-crop-top-right"
            style={[
              s.handle,
              {
                left: cropRect.x + cropRect.width - HANDLE_TOUCH_SIZE,
                top: cropRect.y,
              },
            ]}
            {...topRightResponder.panHandlers}
          >
            <View
              style={[
                s.cornerMark,
                { right: 0, top: 0, borderRightWidth: 4, borderTopWidth: 4 },
              ]}
            />
          </View>
          <View
            testID="free-crop-bottom-left"
            style={[
              s.handle,
              {
                left: cropRect.x,
                top: cropRect.y + cropRect.height - HANDLE_TOUCH_SIZE,
              },
            ]}
            {...bottomLeftResponder.panHandlers}
          >
            <View
              style={[
                s.cornerMark,
                { left: 0, bottom: 0, borderLeftWidth: 4, borderBottomWidth: 4 },
              ]}
            />
          </View>
          <View
            testID="free-crop-bottom-right"
            style={[
              s.handle,
              {
                left: cropRect.x + cropRect.width - HANDLE_TOUCH_SIZE,
                top: cropRect.y + cropRect.height - HANDLE_TOUCH_SIZE,
              },
            ]}
            {...bottomRightResponder.panHandlers}
          >
            <View
              style={[
                s.cornerMark,
                { right: 0, bottom: 0, borderRightWidth: 4, borderBottomWidth: 4 },
              ]}
            />
          </View>
        </>
      ) : null}
    </View>
  );
}
