import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MediaImage } from '@/components/ui/media-image';
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
  /**
   * 单图也只占九宫格的一格。圈子动态列表要卡片高度接近，单图放大会让那一条
   * 比别的帖子高出一截；朋友圈保留单图大图。
   */
  uniformCells?: boolean;
}

interface DisplayImage {
  thumbUri: string;
  originalUri: string;
  thumbCacheKey?: string;
  originalCacheKey?: string;
}

const GAP = Spacing.xs;
const COLUMNS = 3;

function firstString(
  ...values: (string | null | undefined)[]
): string | undefined {
  return values.find(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
}

export function getDisplayImages(
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
    const thumb = firstString(variant?.thumbUrl, variant?.thumb);
    const thumbUri = thumb ?? previewUri ?? originalUri;
    const originalCacheKey = firstString(variant?.originalKey, variant?.key) ?? originalUri;
    const variantName = thumb ? 'thumb' : 'preview';
    return {
      thumbUri,
      originalUri,
      thumbCacheKey:
        thumbUri === originalUri
          ? originalCacheKey
          : firstString(
              thumb ? variant?.thumbKey : variant?.previewKey,
              variant?.key ? `${variant.key}:${variantName}` : undefined,
            ) ?? thumbUri,
      originalCacheKey,
    };
  });
}

/**
 * 九宫格骨架：每行 3 格均分父容器的实际宽度；单图大图占 65% 宽的正方形。
 * 不按屏幕宽度推算像素 —— 各页面左右留白不同，推算多出几 pt，第三格就会掉到下一行。
 */
export function NineGrid({ count, single, renderCell, children }: {
  count: number;
  /** 单图大图，而不是九宫格里的一格。 */
  single: boolean;
  /** 返回的元素会被撑满所在格子（需自带 flex: 1）。 */
  renderCell: (index: number) => ReactNode;
  /** 跟随网格挂载的附属元素（全屏查看器）。 */
  children?: ReactNode;
}) {
  if (single) {
    return (
      <View style={s.single}>
        {renderCell(0)}
        {children}
      </View>
    );
  }
  const rows = Array.from({ length: Math.ceil(count / COLUMNS) }, (_, row) => row);
  return (
    <View style={s.grid}>
      {rows.map((row) => (
        <View key={row} style={s.row}>
          {Array.from({ length: COLUMNS }, (_, column) => {
            const index = row * COLUMNS + column;
            return (
              <View key={column} style={s.cell}>
                {index < count ? renderCell(index) : null}
              </View>
            );
          })}
        </View>
      ))}
      {children}
    </View>
  );
}

export const ImageGrid: React.FC<ImageGridProps> = ({
  images,
  media,
  onPress,
  uniformCells = false,
}) => {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const displayImages = useMemo(
    () => getDisplayImages(images, media),
    [images, media],
  );

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
    <NineGrid
      count={displayImages.length}
      single={displayImages.length === 1 && !uniformCells}
      renderCell={(i) => {
        const item = displayImages[i];
        return (
          <Pressable
            onPress={() => handlePress(i)}
            accessibilityRole="imagebutton"
            style={s.imageWrap}
          >
            <MediaImage
              source={{
                uri: item.thumbUri,
                ...(item.thumbCacheKey ? { cacheKey: item.thumbCacheKey } : {}),
              }}
              recyclingKey={item.thumbCacheKey ?? item.thumbUri}
              cachePolicy="memory-disk"
              enforceEarlyResizing
              style={s.image}
              contentFit="cover"
              transition={0}
            />
          </Pressable>
        );
      }}
    >
      {viewerIndex !== null ? (
        <ImageViewer
          images={viewerImages}
          cacheKeys={viewerCacheKeys}
          visible
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      ) : null}
    </NineGrid>
  );
};

const s = StyleSheet.create({
  // alignSelf 保证父容器 alignItems 不是 stretch 时网格仍铺满整行。
  grid: { alignSelf: 'stretch', gap: GAP },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: GAP },
  cell: { flex: 1, aspectRatio: 1 },
  single: { width: '65%', aspectRatio: 1 },
  imageWrap: {
    flex: 1,
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
