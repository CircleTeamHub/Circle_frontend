import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useContentColumnWidth } from '@/components/app/desktop-centered-column';
import { ImageViewer } from '@/components/ui/image-viewer';
import { Radius, Spacing } from '@/theme';
import type { ImageMediaVariant } from '@/types';

interface ImageGridProps {
  /** Legacy URLs remain supported for old posts and cached API responses. */
  images: string[];
  /** Optional thumb/preview/original metadata from the media API. */
  media?: ImageMediaVariant[];
  /** 覆盖点图行为；不传时用内置的全屏大图查看器（默认且期望的行为）。 */
  onPress?: (index: number) => void;
  /** 外部容器可用宽度（相册行的内容列宽度）。缺省时按 discover 卡片布局计算。 */
  containerWidth?: number;
}

interface DisplayImage {
  thumbUri: string;
  originalUri: string;
  thumbCacheKey?: string;
  originalCacheKey?: string;
  previewUri?: string;
}

const GAP = Spacing.xs;

function firstString(
  ...values: (string | null | undefined)[]
): string | undefined {
  return values.find(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
}

function getDisplayImages(
  images: string[],
  media?: ImageMediaVariant[],
): DisplayImage[] {
  return images.map((legacyUri, index) => {
    const variant = media?.[index];
    const originalUri =
      firstString(
        variant?.originalUrl,
        variant?.original,
        legacyUri,
        variant?.previewUrl,
        variant?.preview,
        variant?.thumbUrl,
        variant?.thumb,
      ) ?? legacyUri;
    const previewUri = firstString(variant?.previewUrl, variant?.preview);
    const thumbUri =
      firstString(variant?.thumbUrl, variant?.thumb, previewUri, originalUri) ??
      originalUri;
    const hasSeparateThumb = thumbUri !== originalUri;
    return {
      thumbUri,
      originalUri,
      previewUri,
      thumbCacheKey:
        firstString(
          variant?.thumbKey,
          hasSeparateThumb ? undefined : variant?.key,
        ) ?? thumbUri,
      originalCacheKey:
        firstString(variant?.originalKey, variant?.key) ?? originalUri,
    };
  });
}

export const ImageGrid: React.FC<ImageGridProps> = ({
  images,
  media,
  onPress,
  containerWidth: containerWidthProp,
}) => {
  // 桌面网页版里这是居中栏宽（640），不是 1440 的视口宽。
  const availableWidth = useContentColumnWidth();
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const containerWidth =
    containerWidthProp ?? availableWidth - Spacing.lg * 2 - Spacing.md * 2;
  const displayImages = useMemo(
    () => getDisplayImages(images, media),
    [images, media],
  );

  const layout = useMemo(() => {
    const count = displayImages.length;
    if (count === 0) return { cols: 0, rows: 0, itemSize: 0 };
    if (count === 1) return { cols: 1, rows: 1, itemSize: containerWidth * 0.65 };
    if (count === 2) return { cols: 2, rows: 1, itemSize: (containerWidth - GAP) / 2 };
    if (count === 4) return { cols: 2, rows: 2, itemSize: (containerWidth - GAP) / 2 };
    return {
      cols: 3,
      rows: Math.ceil(count / 3),
      itemSize: (containerWidth - GAP * 2) / 3,
    };
  }, [displayImages.length, containerWidth]);

  const handlePress = useCallback(
    (index: number) => {
      if (onPress) {
        onPress(index);
        return;
      }
      setViewerIndex(index);
    },
    [onPress],
  );

  if (displayImages.length === 0) return null;

  const viewerImages = displayImages.map((item) => item.originalUri);
  const viewerCacheKeys = displayImages.map((item) => item.originalCacheKey);

  return (
    <View style={s.grid}>
      {displayImages.map((item, i) => (
        <Pressable
          key={`${item.originalCacheKey ?? item.originalUri}-${i}`}
          onPress={() => handlePress(i)}
          style={[
            s.imageWrap,
            {
              width: layout.itemSize,
              height: layout.itemSize,
              marginRight: (i + 1) % layout.cols === 0 ? 0 : GAP,
              marginBottom: GAP,
            },
          ]}
        >
          <Image
            source={{
              uri: item.thumbUri,
              ...(item.thumbCacheKey ? { cacheKey: item.thumbCacheKey } : {}),
            }}
            placeholder={
              item.previewUri && item.previewUri !== item.thumbUri
                ? { uri: item.previewUri }
                : undefined
            }
            recyclingKey={item.thumbCacheKey ?? item.thumbUri}
            // Feed cells should not persist every thumbnail indefinitely; the
            // full-size viewer owns disk caching for images the user opens.
            cachePolicy="memory"
            enforceEarlyResizing
            style={s.image}
            contentFit="cover"
            transition={120}
          />
        </Pressable>
      ))}
      {viewerIndex !== null ? (
        <ImageViewer
          images={viewerImages}
          cacheKeys={viewerCacheKeys}
          visible
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      ) : null}
    </View>
  );
};

const s = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  imageWrap: {
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
