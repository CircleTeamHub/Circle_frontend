import { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import { Avatar } from '@/components/ui/avatar';
import type { ChatMessage } from '@/types';
import { AVATAR_SIZE, BubbleStatusText } from './shared';

interface ImageBubbleProps {
  message: ChatMessage;
  outgoing: boolean;
  senderName?: string;
  senderAvatarUri?: string;
  selfName?: string;
  selfAvatarUri?: string;
  onAvatarPress?: () => void;
  hideStatus?: boolean;
}

const sImage = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  rowOutgoing: {
    justifyContent: 'flex-end',
  },
  body: {
    maxWidth: 240,
  },
  bodyOutgoing: {
    alignItems: 'flex-end',
  },
  imageWrap: {
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  image: {
    width: 220,
    height: 220,
  },
  avatarSlot: { paddingBottom: 2 },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
});

export const ImageBubble: React.FC<ImageBubbleProps> = ({
  message,
  outgoing,
  senderName,
  senderAvatarUri,
  selfName,
  selfAvatarUri,
  onAvatarPress,
  hideStatus,
}) => {
  const { colors } = useTheme();
  const avatarNode = (
    <Avatar
      size={AVATAR_SIZE}
      shape="square"
      name={outgoing ? selfName : senderName}
      uri={outgoing ? selfAvatarUri : senderAvatarUri}
    />
  );

  const dimensions = useMemo(() => {
    if (!message.imageWidth || !message.imageHeight) {
      return { width: 220, height: 220 };
    }
    const maxSide = 220;
    const ratio = message.imageWidth / message.imageHeight;
    return ratio >= 1
      ? { width: maxSide, height: Math.round(maxSide / ratio) }
      : { width: Math.round(maxSide * ratio), height: maxSide };
  }, [message.imageHeight, message.imageWidth]);

  // 列表气泡优先渲染缩略图；缺失时回退到原图。原图查看留给点击放大流程。
  const displayUri = message.imageThumbUrl ?? message.imageUrl;
  const imageNode = (
    <View style={[sImage.body, outgoing ? sImage.bodyOutgoing : null]}>
      <View style={sImage.imageWrap}>
        {displayUri ? (
          <Image
            source={{ uri: displayUri }}
            style={[sImage.image, dimensions]}
            contentFit="cover"
            transition={150}
            cachePolicy="memory-disk"
            onError={(event) => {
              if (__DEV__) {
                console.warn('[chat] image load failed', {
                  uri: displayUri,
                  error: event.error,
                });
              }
            }}
          />
        ) : null}
      </View>
      {message.time ? (
        <View style={sImage.timeRow}>
          <Text
            style={{
              ...Typography.tinyRegular,
              color: colors.textSecondary,
            }}
          >
            {message.time}
          </Text>
          {outgoing && !hideStatus ? <BubbleStatusText message={message} /> : null}
        </View>
      ) : null}
    </View>
  );

  if (outgoing) {
    return (
      <View style={[sImage.row, sImage.rowOutgoing]}>
        {imageNode}
        <View style={sImage.avatarSlot}>{avatarNode}</View>
      </View>
    );
  }

  return (
    <View style={sImage.row}>
      {onAvatarPress ? (
        <Pressable style={sImage.avatarSlot} onPress={onAvatarPress}>
          {avatarNode}
        </Pressable>
      ) : (
        <View style={sImage.avatarSlot}>{avatarNode}</View>
      )}
      {imageNode}
    </View>
  );
};
