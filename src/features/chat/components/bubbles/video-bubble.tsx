import { isEphemeralMessage } from '@/features/chat/utils/ephemeral-message';
import { MediaImage } from '@/components/ui/media-image';
import { MediaProgressBar } from '@/components/ui/media-progress-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { cachedVideoSource } from '@/utils/video-source';
import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import type { ChatMessage } from '@/types';
import { useEphemeralImageDiskCacheSweep } from './ephemeral-image-cache';
import { BubbleStatusText, MessageAvatar } from './shared';
import { MediaUploadProgress } from './media-upload-progress';
import { UploadProgressHost } from '@/components/app/UploadProgressHost';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { reportHandledFailure } from '@/observability/report-failure';

interface VideoBubbleProps {
  message: ChatMessage;
  outgoing: boolean;
  senderName?: string;
  senderAvatarUri?: string;
  selfName?: string;
  selfAvatarUri?: string;
  onAvatarPress?: () => void;
  onAvatarLongPress?: () => void;
  onLongPress?: (event: GestureResponderEvent) => void;
  hideStatus?: boolean;
  /** 本人开了阅后即焚:封面和图片一样只进内存缓存,不落盘。 */
  selfDestructEnabled?: boolean;
  /** 焚毁策略指纹:换了策略要清一次开启前落过盘的封面(见 ephemeral-image-cache)。 */
  selfDestructCacheKey?: string;
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  rowOutgoing: { justifyContent: 'flex-end' },
  body: { maxWidth: 240 },
  bodyOutgoing: { alignItems: 'flex-end' },
  frame: {
    width: 220,
    overflow: 'hidden',
    borderRadius: Radius.md,
    backgroundColor: '#000',
  },
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
  poster: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  // 有封面帧时只压一层薄暗,让画面透出来、播放键仍看得清。
  posterOverImage: { backgroundColor: 'rgba(0,0,0,0.2)' },
  playBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  duration: {
    ...Typography.tinyRegular,
    color: '#FFFFFF',
    position: 'absolute',
    right: Spacing.xs,
    bottom: Spacing.xs,
  },
  unavailable: {
    width: 220,
    aspectRatio: 16 / 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unavailableText: { ...Typography.small, marginTop: Spacing.xs },
  avatarSlot: { paddingBottom: 2 },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
});

function formatDuration(seconds?: number): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  const total = Math.round(seconds);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

/** Mount only while the fullscreen modal is open; useVideoPlayer releases on unmount. */
function FullscreenVideo({ videoUrl, ephemeral }: { videoUrl: string; ephemeral: boolean }) {
  const { t } = useTranslation();
  const player = useVideoPlayer(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    const subscription = player.addListener('statusChange', ({ status }) => {
      if (cancelled) return;
      setLoading(status === 'loading' || status === 'idle');
      if (status === 'error') {
        setFailed(true);
        setLoading(false);
        reportHandledFailure('chatMedia', 'videoPlayback', new Error('Video playback failed'));
      }
    });
    void player.replaceAsync(cachedVideoSource(videoUrl, !ephemeral)).then(() => {
      if (!cancelled) player.play();
    }).catch(() => {
      if (!cancelled) {
        setFailed(true);
        setLoading(false);
        reportHandledFailure('chatMedia', 'videoLoad', new Error('Video load failed'));
      }
    });
    return () => { cancelled = true; subscription.remove(); };
  }, [attempt, ephemeral, player, videoUrl]);
  return (
    <>
      <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls contentFit="contain" surfaceType="textureView" />
      {loading ? <View style={s.playbackStatus} pointerEvents="none" accessible accessibilityRole="progressbar" accessibilityLabel={t('common.loading')}><MediaProgressBar percent={null} /></View> : null}
      {failed ? (
        <View style={s.playbackStatus}>
          <Text style={s.playbackText}>{t('chat.detail.videoUnavailable')}</Text>
          <Pressable style={s.retryButton} onPress={() => setAttempt((value) => value + 1)} accessibilityRole="button" accessibilityLabel={t('common.retry')}>
            <Text style={s.playbackText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

export function VideoBubble({
  message,
  outgoing,
  senderName,
  senderAvatarUri,
  selfName,
  selfAvatarUri,
  onAvatarPress,
  onAvatarLongPress,
  onLongPress,
  hideStatus,
  selfDestructEnabled = false,
  selfDestructCacheKey = '',
}: VideoBubbleProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [previewVisible, setPreviewVisible] = useState(false);
  const [posterLoading, setPosterLoading] = useState(false);

  const aspectRatio = useMemo(() => {
    const width = message.videoWidth ?? 0;
    const height = message.videoHeight ?? 0;
    if (width <= 0 || height <= 0) return 16 / 9;
    return Math.min(16 / 9, Math.max(3 / 4, width / height));
  }, [message.videoHeight, message.videoWidth]);
  const durationLabel = formatDuration(message.videoDuration);
  const posterUrl = message.videoThumbUrl;
  const ephemeral = isEphemeralMessage(message, selfDestructEnabled);
  useEphemeralImageDiskCacheSweep(ephemeral, selfDestructCacheKey);

  const videoUrl = message.videoUrl;
  useEffect(() => {
    setPreviewVisible(false);
  }, [ephemeral, selfDestructCacheKey]);
  const videoViewer = previewVisible && videoUrl ? (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={() => setPreviewVisible(false)}>
      <View style={s.fullscreen}>
        <FullscreenVideo key={videoUrl} videoUrl={videoUrl} ephemeral={ephemeral} />
        <Pressable style={[s.closeButton, { top: insets.top + Spacing.sm }]} onPress={() => setPreviewVisible(false)} accessibilityRole="button" accessibilityLabel={t('common.close')}>
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
        <UploadProgressHost />
      </View>
    </Modal>
  ) : null;

  const avatarNode = (
    <MessageAvatar
      message={message}
      outgoing={outgoing}
      selfName={selfName}
      selfAvatarUri={selfAvatarUri}
      senderName={senderName}
      senderAvatarUri={senderAvatarUri}
      onPress={outgoing ? onAvatarPress : undefined}
    />
  );
  const body = (
    <View style={[s.body, outgoing ? s.bodyOutgoing : null]}>
      <View style={s.frame}>
        <Pressable
          onPress={videoUrl ? () => setPreviewVisible(true) : undefined}
          onLongPress={onLongPress}
          delayLongPress={350}
          accessibilityRole={videoUrl ? 'button' : undefined}
          accessibilityLabel={
            videoUrl
              ? t('chat.detail.playVideo', { defaultValue: '播放视频' })
              : undefined
          }
        >
          {videoUrl ? (
            <View style={{ aspectRatio }}>
              {!posterUrl ? null : (
                <MediaImage
                  testID="chat-video-poster"
                  source={
                    message.videoThumbKey
                      ? { uri: posterUrl, cacheKey: message.videoThumbKey }
                      : { uri: posterUrl }
                  }
                  style={StyleSheet.absoluteFillObject}
                  contentFit="cover"
                  cachePolicy={ephemeral ? 'memory' : 'memory-disk'}
                  pointerEvents="none"
                  onLoadStart={() => setPosterLoading(true)}
                  onLoadEnd={() => setPosterLoading(false)}
                />
              )}
              {posterUrl && posterLoading ? null : <View
                style={[s.poster, posterUrl ? s.posterOverImage : null]}
                pointerEvents="none"
              >
                <View style={s.playBadge}>
                  <Ionicons name="play" size={26} color="#FFFFFF" />
                </View>
                {durationLabel ? (
                  <Text style={s.duration}>{durationLabel}</Text>
                ) : null}
              </View>}
            </View>
          ) : (
            <View style={s.unavailable}>
              <Ionicons name="videocam-off-outline" size={30} color={colors.textSecondary} />
              <Text style={[s.unavailableText, { color: colors.text }]}>
                {t('chat.detail.videoUnavailable', { defaultValue: '视频不可用' })}
              </Text>
            </View>
          )}
        </Pressable>
        {outgoing && message.sendStatus === 1 && message.deliveryId ? (
          <MediaUploadProgress deliveryId={message.deliveryId} kind="video" />
        ) : null}
      </View>
      {message.time ? (
        <View style={s.timeRow}>
          <Text style={{ ...Typography.tinyRegular, color: colors.text }}>
            {message.time}
          </Text>
          {outgoing && !hideStatus ? <BubbleStatusText message={message} /> : null}
        </View>
      ) : null}
    </View>
  );

  if (outgoing) {
    return (
      <>
        <View style={[s.row, s.rowOutgoing]}>
          {body}
          <View style={s.avatarSlot}>{avatarNode}</View>
        </View>
        {videoViewer}
      </>
    );
  }
  return (
    <>
      <View style={s.row}>
        {onAvatarPress || onAvatarLongPress ? (
          <Pressable style={s.avatarSlot} onPress={onAvatarPress} onLongPress={onAvatarLongPress} delayLongPress={350}>
            {avatarNode}
          </Pressable>
        ) : (
          <View style={s.avatarSlot}>{avatarNode}</View>
        )}
        {body}
      </View>
      {videoViewer}
    </>
  );
}
