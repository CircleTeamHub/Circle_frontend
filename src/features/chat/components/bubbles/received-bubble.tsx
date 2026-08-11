import { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import i18n from '@/i18n';
import { useTheme, Spacing, Typography } from '@/theme';
import type { ChatMessage } from '@/types';
import { MessageAvatar } from './shared';

interface ReceivedBubbleProps {
  /** G-07:点按某个回应 pill 切换自己的回应。 */
  onReactionPress?: (emoji: string) => void;
  message: ChatMessage;
  senderName?: string;
  senderAvatarUri?: string;
  onAvatarPress?: () => void;
  /** 真引用(G-09):点击引用块定位到原消息;原消息不可达时不传。 */
  onQuotePress?: () => void;
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
  onQuotePress,
  onReactionPress,
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
    <MessageAvatar
      message={message}
      outgoing={false}
      senderName={senderName}
      senderAvatarUri={senderAvatarUri}
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
            onQuotePress ? (
              <Pressable
                style={[sReceived.quoteBox, d.quoteBox]}
                onPress={onQuotePress}
              >
                <Text style={d.quoteText} numberOfLines={2}>{message.quotedText}</Text>
              </Pressable>
            ) : (
              <View style={[sReceived.quoteBox, d.quoteBox]}>
                <Text style={d.quoteText} numberOfLines={2}>{message.quotedText}</Text>
              </View>
            )
          ) : null}
          <Text style={d.bubbleText}>
            {message.text}
            {message.edited
              ? ` ${i18n.t('chat.message.edited', { defaultValue: '(已编辑)' })}`
              : ''}
          </Text>
          {message.reactions?.length ? (
            <View style={sReactions.row}>
              {message.reactions.map((reaction) => (
                <Pressable
                  key={reaction.emoji}
                  style={[
                    sReactions.pill,
                    reaction.mine ? sReactions.pillMine : null,
                  ]}
                  onPress={
                    onReactionPress
                      ? () => onReactionPress(reaction.emoji)
                      : undefined
                  }
                >
                  <Text style={sReactions.pillText}>
                    {reaction.emoji} {reaction.count}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
        {message.time ? (
          <Text style={d.timeText}>{message.time}</Text>
        ) : null}
      </View>
    </View>
  );
};


/** G-07 表情回应 pills(两种气泡共用样式,mine 高亮边框)。 */
const sReactions = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  pill: {
    flexDirection: 'row',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: 'rgba(127,127,127,0.15)',
  },
  pillMine: { borderWidth: 1, borderColor: 'rgba(127,127,127,0.6)' },
  pillText: { fontSize: 12 },
});
