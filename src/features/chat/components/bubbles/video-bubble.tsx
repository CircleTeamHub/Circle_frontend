import { isEphemeralMessage } from '@/features/chat/utils/ephemeral-message';
import { MediaImage } from '@/components/ui/media-image';
import { useMemo } from 'react';
import {
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
import { ExpiredMediaPlaceholder } from './expired-media-placeholder';

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
  /** 全屏播放归会话级查看器，和图片共用一个画廊。 */
  onVideoPress: (message: ChatMessage) => void;
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
  // 已过期的占位自带浅底,不透出播放器的黑框。
  frameExpired: { backgroundColor: 'transparent' },
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
  onVideoPress,
  hideStatus,
  selfDestructEnabled = false,
  selfDestructCacheKey = '',
}: VideoBubbleProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();

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
  const playOverlay = (
    <View
      style={[s.poster, posterUrl ? s.posterOverImage : null]}
      pointerEvents="none"
    >
      <View style={s.playBadge}>
        <Ionicons name="play" size={26} color="#FFFFFF" />
      </View>
      {durationLabel ? (
        <Text style={s.duration}>{durationLabel}</Text>
      ) : null}
    </View>
  );
  const body = (
    <View style={[s.body, outgoing ? s.bodyOutgoing : null]}>
      <View style={[s.frame, message.mediaExpired ? s.frameExpired : null]}>
        <Pressable
          onPress={videoUrl ? () => onVideoPress(message) : undefined}
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
              {posterUrl ? (
                // 播放键交给 MediaImage 画在封面上、下载进度下面:下载慢时进度盖住它,显示后露出来。
                // 原来这里自己记「封面加载中」,每个视频划进来都要让整个气泡多渲染两遍。
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
                  overlay={playOverlay}
                />
              ) : playOverlay}
            </View>
          ) : message.mediaExpired ? (
            <ExpiredMediaPlaceholder kind="video" style={{ aspectRatio }} />
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
    </>
  );
}
