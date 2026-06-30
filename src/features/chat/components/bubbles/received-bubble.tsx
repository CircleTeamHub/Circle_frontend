import { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useTheme, Spacing, Typography } from '@/theme';
import { Avatar } from '@/components/ui/avatar';
import type { ChatMessage } from '@/types';
import { AVATAR_SIZE } from './shared';

interface ReceivedBubbleProps {
  message: ChatMessage;
  senderName?: string;
  senderAvatarUri?: string;
  onAvatarPress?: () => void;
}

const sReceived = StyleSheet.create({
  receivedRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  receivedBubble: {
    borderTopLeftRadius: 4,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 18,
    borderBottomLeftRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
    maxWidth: 280,
  },
  receivedContent: {
    maxWidth: 280,
  },
  receivedAvatarSlot: {
    paddingBottom: 2,
  },
  quoteBox: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 6,
    maxWidth: 240,
  },
});

export const ReceivedBubble: React.FC<ReceivedBubbleProps> = ({
  message,
  // 缺省值之前写死成 '陈' —— 一旦后端漏传 senderNickname，每个聊天都会显示 "陈"。
  // 空字符串让 Avatar 自身回退到首字母 / 图标占位。
  senderName = '',
  senderAvatarUri,
  onAvatarPress,
}) => {
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      receivedBubble: {
        backgroundColor: colors.receivedBubble,
      },
      bubbleText: {
        color: colors.text,
        ...Typography.bodyRegular,
        lineHeight: 20,
      },
      timeText: {
        color: colors.textSecondary,
        ...Typography.tinyRegular,
        marginTop: Spacing.xs,
      },
      quoteBox: {
        backgroundColor: colors.surface,
      },
      quoteText: {
        color: colors.textSecondary,
        ...Typography.tinyRegular,
      },
    }),
    [colors],
  );

  const avatarNode = (
    <Avatar
      size={AVATAR_SIZE}
      shape="square"
      name={senderName}
      uri={senderAvatarUri}
    />
  );

  return (
    <View style={sReceived.receivedRow}>
      {onAvatarPress ? (
        <Pressable style={sReceived.receivedAvatarSlot} onPress={onAvatarPress}>
          {avatarNode}
        </Pressable>
      ) : (
        <View style={sReceived.receivedAvatarSlot}>{avatarNode}</View>
      )}
      <View style={sReceived.receivedContent}>
        <View style={[sReceived.receivedBubble, d.receivedBubble]}>
          {message.quotedText ? (
            <View style={[sReceived.quoteBox, d.quoteBox]}>
              <Text style={d.quoteText} numberOfLines={2}>{message.quotedText}</Text>
            </View>
          ) : null}
          <Text style={d.bubbleText}>{message.text}</Text>
        </View>
        {message.time ? (
          <Text style={d.timeText}>{message.time}</Text>
        ) : null}
      </View>
    </View>
  );
};
