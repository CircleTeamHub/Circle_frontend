import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { MediaImage } from '@/components/ui/media-image';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ImageViewer } from '@/components/ui/image-viewer';
import { Radius } from '@/theme';
import type { ImageMediaVariant, MomentAttachment } from '@/types';
import { getDisplayImages, ImageGrid, NineGrid } from './image-grid';

export function MomentMedia({ images, media, attachments, uniformCells = false }: {
  images: string[];
  media?: ImageMediaVariant[];
  attachments?: MomentAttachment[];
  /** 单个图片/视频也只占九宫格一格（圈子动态卡片），见 ImageGrid 同名参数。 */
  uniformCells?: boolean;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<MomentAttachment | null>(null);
  if (!attachments?.some((item) => item.type === 'video')) return <ImageGrid images={images} media={media} uniformCells={uniformCells} />;
  const photos = attachments.filter((item) => item.type === 'image');
  const displayPhotos = getDisplayImages(
    photos.map((item) => item.url),
    photos.map((item, index) => ({ ...media?.[index], key: media?.[index]?.key ?? item.key })),
  );
  return (
    <NineGrid
      count={attachments.length}
      single={attachments.length === 1 && !uniformCells}
      renderCell={(index) => {
        const item = attachments[index];
        const photo = item.type === 'image' ? displayPhotos[photos.indexOf(item)] : undefined;
        const source = photo
          ? { uri: photo.thumbUri, cacheKey: photo.thumbCacheKey }
          : item.posterUrl ? { uri: item.posterUrl, cacheKey: item.posterKey ?? `${item.key}:poster` } : undefined;
        return (
          <Pressable style={s.tile} onPress={() => setSelected(item)} accessibilityRole="button" accessibilityLabel={t(item.type === 'video' ? 'moment.playVideo' : 'moment.openImage', { defaultValue: item.type === 'video' ? '播放视频' : '查看图片' })}>
            {source ? <MediaImage source={source} style={StyleSheet.absoluteFillObject} contentFit="cover" cachePolicy="memory-disk" enforceEarlyResizing recyclingKey={source.cacheKey} /> : null}
            {item.type === 'video' ? <Ionicons name="play-circle" size={40} color="#fff" /> : null}
          </Pressable>
        );
      }}
    >
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
    </NineGrid>
  );
}

const s = StyleSheet.create({
  tile: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.sm, overflow: 'hidden', backgroundColor: '#242424' },
});
