import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useUploadProgressStore } from '@/stores/upload-progress-store';
import { MediaProgressBar } from '@/components/ui/media-progress-bar';

interface MediaUploadProgressProps {
  deliveryId: string;
  kind: 'image' | 'video';
}

/** Mounted only for an outgoing media message that has not been acknowledged. */
export function MediaUploadProgress({ deliveryId, kind }: MediaUploadProgressProps) {
  const { t } = useTranslation();
  // Returning the matching task keeps other messages' byte updates out of this row.
  const task = useUploadProgressStore((state) =>
    Object.values(state.tasks).find((item) => item.progressKey === deliveryId),
  );
  const knownTotal = task?.total != null && task.total > 0 ? task.total : null;
  const confirming = task !== undefined && knownTotal !== null && task.loaded >= knownTotal;
  const percent = task !== undefined && knownTotal !== null && !confirming
    ? Math.floor((task.loaded / knownTotal) * 100)
    : null;
  const status = !task
    ? t('mediaUpload.processing', { defaultValue: '正在处理' })
    : confirming
      ? t('mediaUpload.confirming', { defaultValue: '正在确认' })
      : t('mediaUpload.uploading', { defaultValue: '上传中' });
  const label = percent === null ? status : `${status} ${percent}%`;
  const media = t(`mediaUpload.${kind}`, { defaultValue: kind === 'image' ? '图片' : '视频' });
  return (
    <View
      style={styles.overlay}
      pointerEvents="none"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${media} ${status}`}
      accessibilityState={{ busy: true }}
      accessibilityValue={percent === null ? { text: status } : { min: 0, max: 100, now: percent }}
    >
      <View style={styles.labelRow}>
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
      </View>
      <MediaProgressBar percent={percent} />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  label: { color: '#fff', fontSize: 12, lineHeight: 16, flexShrink: 1 },
});
