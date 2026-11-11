import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MediaImage } from '@/components/ui/media-image';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useContentColumnWidth } from '@/components/app/desktop-centered-column';
import { ImageViewer } from '@/components/ui/image-viewer';
import { Radius, Spacing } from '@/theme';
import type { ImageMediaVariant, MomentAttachment } from '@/types';
import { getDisplayImages, ImageGrid } from './image-grid';

export function MomentMedia({ images, media, attachments, containerWidth, uniformCells = false }: {
  images: string[];
  media?: ImageMediaVariant[];
  attachments?: MomentAttachment[];
  containerWidth?: number;
  /** 单个图片/视频也只占九宫格一格（圈子动态卡片），见 ImageGrid 同名参数。 */
  uniformCells?: boolean;
}) {
  const { t } = useTranslation();
  const availableWidth = useContentColumnWidth();
  const [selected, setSelected] = useState<MomentAttachment | null>(null);
  if (!attachments?.some((item) => item.type === 'video')) return <ImageGrid images={images} media={media} containerWidth={containerWidth} uniformCells={uniformCells} />;
  const width = containerWidth ?? availableWidth - Spacing.lg * 2 - Spacing.md * 2;
  const size = attachments.length === 1 && !uniformCells ? width * 0.65 : Math.floor((width - Spacing.xs * 2) / 3);
  const photos = attachments.filter((item) => item.type === 'image');
  const displayPhotos = getDisplayImages(
    photos.map((item) => item.url),
    photos.map((item, index) => ({ ...media?.[index], key: media?.[index]?.key ?? item.key })),
  );
  return (
    <View style={s.grid}>
      {attachments.map((item, index) => {
        const photo = item.type === 'image' ? displayPhotos[photos.indexOf(item)] : undefined;
        const source = photo
          ? { uri: photo.thumbUri, cacheKey: photo.thumbCacheKey }
          : item.posterUrl ? { uri: item.posterUrl, cacheKey: item.posterKey ?? `${item.key}:poster` } : undefined;
        return (
        <Pressable key={`${item.key}-${index}`} style={[s.tile, { width: size, height: size }]} onPress={() => setSelected(item)} accessibilityRole="button" accessibilityLabel={t(item.type === 'video' ? 'moment.playVideo' : 'moment.openImage', { defaultValue: item.type === 'video' ? '播放视频' : '查看图片' })}>
          {source ? <MediaImage source={source} style={StyleSheet.absoluteFillObject} contentFit="cover" cachePolicy="memory-disk" enforceEarlyResizing recyclingKey={source.cacheKey} /> : null}
          {item.type === 'video' ? <Ionicons name="play-circle" size={40} color="#fff" /> : null}
        </Pressable>
        );
      })}
      {selected ? (
        <ImageViewer
          images={attachments.map((item) => (item.type === 'image' ? displayPhotos[photos.indexOf(item)].originalUri : item.posterUrl ?? ''))}
          cacheKeys={attachments.map((item) => (item.type === 'image' ? displayPhotos[photos.indexOf(item)].originalCacheKey : item.posterKey ?? `${item.key}:poster`))}
          videos={attachments.map((item) => (item.type === 'video' ? item.url : undefined))}
          autoPlayInitialVideo={selected.type === 'video'}
          visible
          initialIndex={attachments.findIndex((item) => item.key === selected.key)}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  tile: { alignItems: 'center', justifyContent: 'center', borderRadius: Radius.sm, overflow: 'hidden', backgroundColor: '#242424' },
});
