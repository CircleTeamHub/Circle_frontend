import { useMemo } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Radius, Spacing } from '@/theme';

interface ImageGridProps {
  images: string[];
  onPress?: (index: number) => void;
  /** 外部容器可用宽度（相册行的内容列宽度）。缺省时按 discover 卡片布局计算。 */
  containerWidth?: number;
}

const GAP = Spacing.xs;

export const ImageGrid: React.FC<ImageGridProps> = ({
  images,
  onPress,
  containerWidth: containerWidthProp,
}) => {
  const { width: screenWidth } = useWindowDimensions();
  const containerWidth =
    containerWidthProp ?? screenWidth - Spacing.lg * 2 - Spacing.md * 2;

  const layout = useMemo(() => {
    const count = images.length;
    if (count === 0) return { cols: 0, rows: 0, itemSize: 0 };
    if (count === 1) return { cols: 1, rows: 1, itemSize: containerWidth * 0.65 };
    if (count === 2) return { cols: 2, rows: 1, itemSize: (containerWidth - GAP) / 2 };
    if (count === 4) return { cols: 2, rows: 2, itemSize: (containerWidth - GAP) / 2 };
    return { cols: 3, rows: Math.ceil(count / 3), itemSize: (containerWidth - GAP * 2) / 3 };
  }, [images.length, containerWidth]);

  if (images.length === 0) return null;

  return (
    <View style={s.grid}>
      {images.map((uri, i) => (
        <Pressable
          key={`${uri}-${i}`}
          onPress={() => onPress?.(i)}
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
            source={{ uri }}
            recyclingKey={uri}
            style={s.image}
            contentFit="cover"
            transition={200}
          />
        </Pressable>
      ))}
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
