import { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import i18n from '@/i18n';
import { useTheme, Spacing, Typography } from '@/theme';
import type { ChatMessage } from '@/types';
import { MessageAvatar } from './shared';
import { QuotedMessageBlock } from './quoted-message-block';

interface ReceivedBubbleProps {
  /** G-07:点按某个回应 pill 切换自己的回应。 */
  onReactionPress?: (emoji: string) => void;
  message: ChatMessage;
  senderName?: string;
  senderAvatarUri?: string;
  onAvatarPress?: () => void;
  onAvatarLongPress?: () => void;
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
    // 气泡下方挂引用块后,列宽可能被引用块撑开:各自按内容宽,气泡别被拉宽。
    alignItems: 'flex-start',
  },
  receivedAvatarSlot: {
    paddingBottom: 2,
  },
});

export const ReceivedBubble: React.FC<ReceivedBubbleProps> = ({
  message,
  // 缺省值之前写死成 '陈' —— 一旦后端漏传 senderNickname，每个聊天都会显示 "陈"。
  // 空字符串让 Avatar 自身回退到首字母 / 图标占位。
  senderName = '',
  senderAvatarUri,
  onAvatarPress,
  onAvatarLongPress,
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
        color: colors.text,
        ...Typography.tinyRegular,
        marginTop: Spacing.xs,
      },
      // G-07 回应 pill：走主题色淡底，不再用中性灰（暗色下灰底/灰边几乎看不见）。
      pill: { backgroundColor: colors.primaryLight },
      pillMine: { borderColor: colors.primary },
      pillText: { color: colors.text },
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
      {onAvatarPress || onAvatarLongPress ? (
        <Pressable style={sReceived.receivedAvatarSlot} onPress={onAvatarPress} onLongPress={onAvatarLongPress} delayLongPress={350}>
          {avatarNode}
        </Pressable>
      ) : (
        <View style={sReceived.receivedAvatarSlot}>{avatarNode}</View>
      )}
      <View style={sReceived.receivedContent}>
        <View style={[sReceived.receivedBubble, d.receivedBubble]}>
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
                    d.pill,
                    reaction.mine ? d.pillMine : null,
                  ]}
                  onPress={
                    onReactionPress
                      ? () => onReactionPress(reaction.emoji)
                      : undefined
                  }
                >
                  <Text style={[sReactions.pillText, d.pillText]}>
                    {reaction.emoji} {reaction.count}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
        {message.quotedText ? (
          <QuotedMessageBlock message={message} align="start" onPress={onQuotePress} />
        ) : null}
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
    borderWidth: 1,
    borderColor: 'transparent',
  },
  pillText: { fontSize: 12 },
});
