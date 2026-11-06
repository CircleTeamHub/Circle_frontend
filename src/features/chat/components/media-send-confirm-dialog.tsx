import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { ImagePickerAsset } from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { SendConfirmDialog } from '@/features/chat/components/send-confirm-dialog';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface MediaSendConfirmDialogProps {
  assets: ImagePickerAsset[] | null;
  onCancel: () => void;
  onSend: (caption: string) => void;
}

const THUMB_SIZE = 72;

const s = StyleSheet.create({
  strip: {
    gap: Spacing.sm,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  videoBadge: {
    position: 'absolute',
    left: Spacing.xs,
    bottom: Spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  videoText: {
    ...Typography.tiny,
    color: '#FFFFFF',
  },
});

function formatDuration(durationMs: number | null | undefined): string {
  const totalSeconds = Math.max(0, Math.round((durationMs ?? 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** 相册一次选了多项(或选了视频)后的发送确认:预览所选内容,可附一句描述。 */
export function MediaSendConfirmDialog({ assets, onCancel, onSend }: MediaSendConfirmDialogProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const thumbBackground = useMemo(() => ({ backgroundColor: colors.inputBg }), [colors]);
  const count = assets?.length ?? 0;

  return (
    <SendConfirmDialog
      visible={assets !== null}
      title={t('chat.mediaSend.title', { count, defaultValue: '发送 {{count}} 项内容' })}
      placeholder={t('chat.mediaSend.captionPlaceholder', { defaultValue: '添加描述（可选）' })}
      confirmLabel={t('chat.mediaSend.confirm', { count, defaultValue: '发送（{{count}}）' })}
      onCancel={onCancel}
      onConfirm={onSend}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.strip}>
        {(assets ?? []).map((asset) => (
          <View key={asset.assetId ?? asset.uri} style={[s.thumb, thumbBackground]}>
            <Image source={{ uri: asset.uri }} style={s.image} contentFit="cover" />
            {asset.type === 'video' ? (
              <View style={s.videoBadge}>
                <Ionicons name="videocam" size={12} color="#FFFFFF" />
                <Text style={s.videoText}>{formatDuration(asset.duration)}</Text>
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </SendConfirmDialog>
  );
}
