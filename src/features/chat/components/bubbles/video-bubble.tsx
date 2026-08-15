import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { BubbleStatusText, MessageAvatar } from './shared';

interface VideoBubbleProps {
  message: ChatMessage;
  outgoing: boolean;
  senderName?: string;
  senderAvatarUri?: string;
  selfName?: string;
  selfAvatarUri?: string;
  onAvatarPress?: () => void;
  onLongPress?: (event: GestureResponderEvent) => void;
  hideStatus?: boolean;
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
  video: { width: '100%' },
  poster: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
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
  onLongPress,
  hideStatus,
}: VideoBubbleProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  // 播放器**不**在挂载时装载媒体源。每个 VideoView 背后都是一个原生播放器实例，
  // 一屏几条视频就会同时占用多路硬件解码器（iOS 上很快到上限，后面的气泡直接黑屏），
  // 还会为每条消息拉取签名 URL 的首段数据。这里先建空播放器，用户点了播放才
  // replaceAsync 装载 —— 列表滚动时只是几张静态封面。
  const player = useVideoPlayer(null, (instance) => {
    instance.loop = false;
  });
  const [activated, setActivated] = useState(false);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const aspectRatio = useMemo(() => {
    const width = message.videoWidth ?? 0;
    const height = message.videoHeight ?? 0;
    if (width <= 0 || height <= 0) return 16 / 9;
    return Math.min(16 / 9, Math.max(3 / 4, width / height));
  }, [message.videoHeight, message.videoWidth]);
  const durationLabel = formatDuration(message.videoDuration);

  const videoUrl = message.videoUrl;
  const handlePlay = useCallback(() => {
    if (!videoUrl || activated || loading) return;
    setLoading(true);
    void player
      .replaceAsync(videoUrl)
      .then(() => {
        if (!mountedRef.current) return;
        setActivated(true);
        player.play();
      })
      .catch(() => {
        // 装载失败(签名过期/网络中断)保持封面态,用户可以再点一次重试。
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, [activated, loading, player, videoUrl]);

  // 签名 URL 会过期后由读路径换发新的一条:源变了就退回封面态,
  // 否则播放器还钉着上一条已失效的 URL。
  useEffect(() => {
    setActivated(false);
  }, [videoUrl]);

  const avatarNode = (
    <MessageAvatar
      message={message}
      outgoing={outgoing}
      selfName={selfName}
      selfAvatarUri={selfAvatarUri}
      senderName={senderName}
      senderAvatarUri={senderAvatarUri}
    />
  );
  const body = (
    <View style={[s.body, outgoing ? s.bodyOutgoing : null]}>
      <Pressable
        style={s.frame}
        onPress={videoUrl && !activated ? handlePlay : undefined}
        onLongPress={onLongPress}
        delayLongPress={350}
        accessibilityRole={videoUrl && !activated ? 'button' : undefined}
        accessibilityLabel={
          videoUrl && !activated
            ? t('chat.detail.playVideo', { defaultValue: '播放视频' })
            : undefined
        }
      >
        {videoUrl ? (
          <View style={{ aspectRatio }}>
            <VideoView
              player={player}
              style={[s.video, StyleSheet.absoluteFillObject]}
              nativeControls={activated}
              contentFit="contain"
              surfaceType="textureView"
            />
            {activated ? null : (
              <View style={s.poster} pointerEvents="none">
                <View style={s.playBadge}>
                  {loading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Ionicons name="play" size={26} color="#FFFFFF" />
                  )}
                </View>
                {durationLabel ? (
                  <Text style={s.duration}>{durationLabel}</Text>
                ) : null}
              </View>
            )}
          </View>
        ) : (
          <View style={s.unavailable}>
            <Ionicons name="videocam-off-outline" size={30} color={colors.textSecondary} />
            <Text style={[s.unavailableText, { color: colors.textSecondary }]}>
              {t('chat.detail.videoUnavailable', { defaultValue: '视频不可用' })}
            </Text>
          </View>
        )}
      </Pressable>
      {message.time ? (
        <View style={s.timeRow}>
          <Text style={{ ...Typography.tinyRegular, color: colors.textSecondary }}>
            {message.time}
          </Text>
          {outgoing && !hideStatus ? <BubbleStatusText message={message} /> : null}
        </View>
      ) : null}
    </View>
  );

  if (outgoing) {
    return (
      <View style={[s.row, s.rowOutgoing]}>
        {body}
        <View style={s.avatarSlot}>{avatarNode}</View>
      </View>
    );
  }
  return (
    <View style={s.row}>
      {onAvatarPress ? (
        <Pressable style={s.avatarSlot} onPress={onAvatarPress}>
          {avatarNode}
        </Pressable>
      ) : (
        <View style={s.avatarSlot}>{avatarNode}</View>
      )}
      {body}
    </View>
  );
}
