import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  PanResponder,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import {
  Blur,
  Canvas,
  Circle,
  Group,
  Image as SkiaImage,
  ImageFormat,
  Mask,
  Path,
  Skia,
  drawAsImage,
  useImage,
  type SkImage,
} from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';
import type { ImagePickerAsset } from 'expo-image-picker';
import {
  appendMarkupPoint,
  normalizeMarkupPoint,
  renderMarkupStroke,
  type PhotoMarkupStroke,
  type PhotoMarkupTool,
  type RenderedMarkupStroke,
} from '@/features/chat/utils/photo-markup';

interface PhotoMarkupEditorProps {
  asset: ImagePickerAsset;
  tool: PhotoMarkupTool;
  color: string;
  accessibilityLabel: string;
  onCanUndoChange: (canUndo: boolean) => void;
  onReadyChange: (ready: boolean) => void;
}

export interface ExportedMarkupPhoto {
  uri: string;
  width: number;
  height: number;
  fileSize: number;
  mimeType: 'image/jpeg' | 'image/png';
}

export interface PhotoMarkupEditorHandle {
  undo: () => void;
  exportImage: () => Promise<ExportedMarkupPhoto | null>;
}

const DRAW_WIDTH_RATIO = 0.014;
const MOSAIC_WIDTH_RATIO = 0.085;
const MOSAIC_BLUR_RATIO = 0.035;

export const PHOTO_MARKUP_EXPORT_MAX_EDGE = 4096;

export function boundedPhotoExportSize(width: number, height: number) {
  const longestEdge = Math.max(width, height);
  if (longestEdge <= PHOTO_MARKUP_EXPORT_MAX_EDGE) return { width, height };
  const scale = PHOTO_MARKUP_EXPORT_MAX_EDGE / longestEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  canvas: {
    position: 'absolute',
  },
  touchSurface: {
    position: 'absolute',
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

function buildPath(stroke: RenderedMarkupStroke) {
  const path = Skia.Path.Make();
  const [first, ...rest] = stroke.points;
  if (!first) return path;
  path.moveTo(first.x, first.y);
  for (const point of rest) path.lineTo(point.x, point.y);
  return path;
}

function StrokeShape({ stroke, mask = false }: {
  stroke: RenderedMarkupStroke;
  mask?: boolean;
}) {
  const color = mask ? '#FFFFFF' : stroke.color;
  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    return (
      <Circle
        cx={point.x}
        cy={point.y}
        r={stroke.strokeWidth / 2}
        color={color}
      />
    );
  }
  return (
    <Path
      path={buildPath(stroke)}
      style="stroke"
      strokeWidth={stroke.strokeWidth}
      strokeCap="round"
      strokeJoin="round"
      color={color}
    />
  );
}

function MarkupScene({
  image,
  width,
  height,
  strokes,
}: {
  image: SkImage;
  width: number;
  height: number;
  strokes: PhotoMarkupStroke[];
}) {
  const rendered = strokes
    .map((stroke) => renderMarkupStroke(stroke, width, height))
    .filter((stroke): stroke is RenderedMarkupStroke => stroke !== null);
  const mosaic = rendered.filter((stroke) => stroke.tool === 'mosaic');
  const drawing = rendered.filter((stroke) => stroke.tool === 'draw');

  return (
    <Group>
      <SkiaImage image={image} x={0} y={0} width={width} height={height} fit="fill" />
      {mosaic.length > 0 ? (
        <Mask
          mode="alpha"
          mask={
            <Group>
              {mosaic.map((stroke) => (
                <StrokeShape key={stroke.id} stroke={stroke} mask />
              ))}
            </Group>
          }
        >
          <SkiaImage image={image} x={0} y={0} width={width} height={height} fit="fill">
            <Blur
              blur={Math.max(8, Math.min(width, height) * MOSAIC_BLUR_RATIO)}
              mode="clamp"
            />
          </SkiaImage>
        </Mask>
      ) : null}
      {drawing.map((stroke) => (
        <StrokeShape key={stroke.id} stroke={stroke} />
      ))}
    </Group>
  );
}

function getPointFromEvent(
  event: GestureResponderEvent,
  width: number,
  height: number,
) {
  return normalizeMarkupPoint(
    event.nativeEvent.locationX,
    event.nativeEvent.locationY,
    width,
    height,
  );
}

export const PhotoMarkupEditor = forwardRef<
  PhotoMarkupEditorHandle,
  PhotoMarkupEditorProps
>(function PhotoMarkupEditor(
  {
    asset,
    tool,
    color,
    accessibilityLabel,
    onCanUndoChange,
    onReadyChange,
  },
  ref,
) {
  const image = useImage(asset.uri);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [strokes, setStrokes] = useState<PhotoMarkupStroke[]>([]);
  const strokesRef = useRef<PhotoMarkupStroke[]>([]);
  const activeStrokeIdRef = useRef<string | null>(null);
  const toolRef = useRef(tool);
  const colorRef = useRef(color);

  toolRef.current = tool;
  colorRef.current = color;

  const photoSize = useMemo(() => {
    if (!containerSize.width || !containerSize.height || !asset.width || !asset.height) {
      return { width: 0, height: 0 };
    }
    const scale = Math.min(
      containerSize.width / asset.width,
      containerSize.height / asset.height,
    );
    return { width: asset.width * scale, height: asset.height * scale };
  }, [asset.height, asset.width, containerSize.height, containerSize.width]);

  useEffect(() => {
    strokesRef.current = strokes;
    onCanUndoChange(strokes.length > 0);
  }, [onCanUndoChange, strokes]);

  useEffect(() => {
    onReadyChange(Boolean(image && photoSize.width && photoSize.height));
    return () => onReadyChange(false);
  }, [image, onReadyChange, photoSize.height, photoSize.width]);

  useEffect(() => {
    setStrokes([]);
    strokesRef.current = [];
    activeStrokeIdRef.current = null;
  }, [asset.uri]);

  const addPoint = useCallback(
    (event: GestureResponderEvent, create: boolean) => {
      const point = getPointFromEvent(event, photoSize.width, photoSize.height);
      if (!point) return;
      if (create) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const next: PhotoMarkupStroke = {
          id,
          tool: toolRef.current,
          color: colorRef.current,
          widthRatio:
            toolRef.current === 'mosaic' ? MOSAIC_WIDTH_RATIO : DRAW_WIDTH_RATIO,
          points: [point],
        };
        activeStrokeIdRef.current = id;
        setStrokes((current) => [...current, next]);
        return;
      }
      const activeId = activeStrokeIdRef.current;
      if (!activeId) return;
      setStrokes((current) =>
        current.map((stroke) =>
          stroke.id === activeId ? appendMarkupPoint(stroke, point) : stroke,
        ),
      );
    },
    [photoSize.height, photoSize.width],
  );

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => addPoint(event, true),
        onPanResponderMove: (event) => addPoint(event, false),
        onPanResponderRelease: () => {
          activeStrokeIdRef.current = null;
        },
        onPanResponderTerminate: () => {
          activeStrokeIdRef.current = null;
        },
      }),
    [addPoint],
  );

  const undo = useCallback(() => {
    setStrokes((current) => current.slice(0, -1));
  }, []);

  const exportImage = useCallback(async () => {
    const current = strokesRef.current;
    if (!image || current.length === 0 || asset.width <= 0 || asset.height <= 0) {
      return null;
    }
    const exportSize = boundedPhotoExportSize(asset.width, asset.height);
    const rendered = await drawAsImage(
      <MarkupScene
        image={image}
        width={exportSize.width}
        height={exportSize.height}
        strokes={current}
      />,
      exportSize,
    );
    const preservePng =
      asset.mimeType === 'image/png' || asset.fileName?.toLowerCase().endsWith('.png');
    const format = preservePng ? ImageFormat.PNG : ImageFormat.JPEG;
    const mimeType = preservePng ? 'image/png' : 'image/jpeg';
    const extension = preservePng ? 'png' : 'jpg';
    try {
      const bytes = rendered.encodeToBytes(format, preservePng ? 100 : 92);
      const file = new File(
        Paths.cache,
        `photo-markup-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`,
      );
      file.create({ overwrite: false, intermediates: true });
      file.write(bytes);
      return {
        uri: file.uri,
        width: exportSize.width,
        height: exportSize.height,
        fileSize: bytes.byteLength,
        mimeType,
      } satisfies ExportedMarkupPhoto;
    } finally {
      rendered.dispose();
    }
  }, [asset.fileName, asset.height, asset.mimeType, asset.width, image]);

  useImperativeHandle(ref, () => ({ undo, exportImage }), [exportImage, undo]);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setContainerSize((current) =>
      current.width === width && current.height === height
        ? current
        : { width, height },
    );
  }, []);

  return (
    <View
      testID="photo-markup-editor"
      style={s.root}
      onLayout={handleLayout}
      accessibilityLabel={accessibilityLabel}
    >
      {image && photoSize.width > 0 && photoSize.height > 0 ? (
        <>
          <Canvas
            testID="photo-markup-canvas"
            style={[
              s.canvas,
              { width: photoSize.width, height: photoSize.height },
            ]}
          >
            <MarkupScene
              image={image}
              width={photoSize.width}
              height={photoSize.height}
              strokes={strokes}
            />
          </Canvas>
          <View
            testID="photo-markup-touch-surface"
            style={[
              s.touchSurface,
              { width: photoSize.width, height: photoSize.height },
            ]}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={accessibilityLabel}
            {...responder.panHandlers}
          />
        </>
      ) : (
        <View style={s.loading}>
          <ActivityIndicator size="large" color="#FFFFFF" />
        </View>
      )}
    </View>
  );
});
