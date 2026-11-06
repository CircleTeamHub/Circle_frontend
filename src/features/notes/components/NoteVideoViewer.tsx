import { UploadProgressHost } from '@/components/app/UploadProgressHost';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { cachedVideoSource } from '@/utils/video-source';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { reportHandledFailure } from '@/observability/report-failure';
import { Radius, Spacing, Typography } from '@/theme';

/** Mount only for the selected video; useVideoPlayer releases it on unmount. */
export function NoteVideoViewer({ uri, onClose }: { uri: string; onClose: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const player = useVideoPlayer(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    const subscription = player.addListener('statusChange', ({ status }) => {
      if (!cancelled && status === 'error') {
        setFailed(true);
        setLoading(false);
        reportHandledFailure('noteEditor', 'videoPlayback', new Error('Video playback failed'));
      }
    });
    // Attach the VideoView before replacing the source, including for local uploads.
    void player.replaceAsync(cachedVideoSource(uri)).then(() => {
      if (!cancelled) player.play();
    }).catch(() => {
      if (!cancelled) {
        setFailed(true);
        reportHandledFailure('noteEditor', 'videoLoad', new Error('Video load failed'));
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [attempt, player, uri]);

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" statusBarTranslucent onRequestClose={onClose}>
      <View style={s.fullscreen}>
        <StatusBar style="light" />
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          nativeControls
          contentFit="contain"
          surfaceType="textureView"
        />
        {loading ? (
          <View style={s.playbackStatus} pointerEvents="none">
            <ActivityIndicator color="#fff" />
          </View>
        ) : null}
        {failed ? (
          <View style={s.playbackStatus}>
            <Text style={s.playbackText}>{t('chat.detail.videoUnavailable')}</Text>
            <Pressable
              style={s.retryButton}
              onPress={() => setAttempt((value) => value + 1)}
              accessibilityRole="button"
              accessibilityLabel={t('common.retry')}
            >
              <Text style={s.playbackText}>{t('common.retry')}</Text>
            </Pressable>
          </View>
        ) : null}
        <Pressable
          style={[s.closeButton, { top: insets.top + Spacing.sm }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        >
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
        <UploadProgressHost />
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  fullscreen: { flex: 1, backgroundColor: '#000' },
  playbackStatus: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  playbackText: { ...Typography.body, color: '#fff' },
  retryButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.lg },
  closeButton: {
    position: 'absolute',
    right: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
});
