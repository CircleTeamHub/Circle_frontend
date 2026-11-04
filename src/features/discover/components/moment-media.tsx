import { useEffect, useState } from 'react';
import { AppState, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useEventListener } from 'expo';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useContentColumnWidth } from '@/components/app/desktop-centered-column';
import { ImageViewer } from '@/components/ui/image-viewer';
import { UploadProgressHost } from '@/components/app/UploadProgressHost';
import { Radius, Spacing } from '@/theme';
import type { ImageMediaVariant, MomentAttachment } from '@/types';
import { ImageGrid } from './image-grid';

function MomentVideo({ url, onClose }: { url: string; onClose: () => void }) {
  const { t } = useTranslation();
  const player = useVideoPlayer(url, (instance) => { instance.loop = false; });
  const [failed, setFailed] = useState(false);
  useEventListener(player, 'statusChange', ({ status }) => setFailed(status === 'error'));
  const close = () => { player.pause(); onClose(); };
  useEffect(() => {
    player.play();
    const subscription = AppState.addEventListener('change', (state) => { if (state !== 'active') player.pause(); });
    // useVideoPlayer releases the decoder on unmount.
    return () => subscription.remove();
  }, [player]);
  return (
    <Modal visible animationType="fade" onRequestClose={close}>
      <View style={s.videoModal}>
        <VideoView player={player} style={s.video} nativeControls contentFit="contain" />
        {failed ? <Text style={s.error}>{t('moment.videoUnavailable', { defaultValue: '视频加载失败，请稍后重试' })}</Text> : null}
        <Pressable style={s.close} onPress={close} accessibilityRole="button" accessibilityLabel={t('common.close')} hitSlop={12}>
          <Ionicons name="close" size={28} color="#fff" />
        </Pressable>
        <UploadProgressHost />
      </View>
    </Modal>
  );
}

export function MomentMedia({ images, media, attachments, containerWidth }: {
  images: string[];
  media?: ImageMediaVariant[];
  attachments?: MomentAttachment[];
  containerWidth?: number;
}) {
  const { t } = useTranslation();
  const availableWidth = useContentColumnWidth();
  const [selected, setSelected] = useState<MomentAttachment | null>(null);
  if (!attachments?.some((item) => item.type === 'video')) return <ImageGrid images={images} media={media} containerWidth={containerWidth} />;
  const width = containerWidth ?? availableWidth - Spacing.lg * 2 - Spacing.md * 2;
  const cols = attachments.length === 1 ? 1 : attachments.length <= 4 ? 2 : 3;
  const size = attachments.length === 1 ? width * 0.65 : (width - Spacing.xs * (cols - 1)) / cols;
  const photos = attachments.filter((item) => item.type === 'image');
  return (
    <View style={s.grid}>
      {attachments.map((item, index) => (
        <Pressable key={`${item.key}-${index}`} style={[s.tile, { width: size, height: size }]} onPress={() => setSelected(item)} accessibilityRole="button" accessibilityLabel={t(item.type === 'video' ? 'moment.playVideo' : 'moment.openImage', { defaultValue: item.type === 'video' ? '播放视频' : '查看图片' })}>
          {item.type === 'image' || item.posterUrl ? <Image source={{ uri: item.type === 'image' ? (media?.[photos.indexOf(item)]?.thumbUrl ?? media?.[photos.indexOf(item)]?.thumb ?? item.url) : item.posterUrl }} style={StyleSheet.absoluteFillObject} contentFit="cover" cachePolicy="memory" enforceEarlyResizing recyclingKey={item.key} /> : null}
          {item.type === 'video' ? <Ionicons name="play-circle" size={40} color="#fff" /> : null}
        </Pressable>
      ))}
      {selected?.type === 'video' ? <MomentVideo key={selected.url} url={selected.url} onClose={() => setSelected(null)} /> : null}
      {selected?.type === 'image' ? <ImageViewer images={photos.map((item) => item.url)} visible initialIndex={photos.findIndex((item) => item.key === selected.key)} onClose={() => setSelected(null)} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  tile: { alignItems: 'center', justifyContent: 'center', borderRadius: Radius.sm, overflow: 'hidden', backgroundColor: '#242424' },
  videoModal: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  video: { width: '100%', height: '100%' },
  close: { position: 'absolute', top: 60, right: 24, padding: 8 },
  error: { position: 'absolute', color: '#fff', alignSelf: 'center', padding: 24 },
});
