import { useVideoPlayer, VideoView } from 'expo-video';
import { useMemo } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
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
  const player = useVideoPlayer(message.videoUrl ?? null, (instance) => {
    instance.loop = false;
  });
  const aspectRatio = useMemo(() => {
    const width = message.videoWidth ?? 0;
    const height = message.videoHeight ?? 0;
    if (width <= 0 || height <= 0) return 16 / 9;
    return Math.min(16 / 9, Math.max(3 / 4, width / height));
  }, [message.videoHeight, message.videoWidth]);

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
      <Pressable style={s.frame} onLongPress={onLongPress} delayLongPress={350}>
        {message.videoUrl ? (
          <VideoView
            player={player}
            style={[s.video, { aspectRatio }]}
            nativeControls
            contentFit="contain"
            surfaceType="textureView"
          />
        ) : (
          <View style={s.unavailable}>
            <Ionicons name="videocam-off-outline" size={30} color={colors.textSecondary} />
            <Text style={[s.unavailableText, { color: colors.textSecondary }]}>视频不可用</Text>
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
