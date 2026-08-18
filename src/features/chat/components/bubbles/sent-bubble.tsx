import { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import i18n from '@/i18n';
import { useTheme, Spacing, Typography } from '@/theme';
import type { ChatMessage } from '@/types';
import { BubbleStatusText, MessageAvatar } from './shared';

interface SentBubbleProps {
  /** G-07:点按某个回应 pill 切换自己的回应。 */
  onReactionPress?: (emoji: string) => void;
  message: ChatMessage;
  selfName?: string;
  selfAvatarUri?: string;
  hideStatus?: boolean;
  /** 真引用(G-09):点击引用块定位到原消息;原消息不可达时不传。 */
  onQuotePress?: () => void;
}

const sSent = StyleSheet.create({
  sentRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
  },
  sentContent: {
    alignItems: 'flex-end',
    maxWidth: 280,
  },
  sentBubble: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 4,
    borderBottomLeftRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
    maxWidth: 280,
  },
  sentAvatarSlot: {
    paddingBottom: 2,
  },
  sentTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  sentStatusIcon: {
    marginTop: 1,
  },
  quoteBox: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 6,
    maxWidth: 240,
  },
});

export const SentBubble: React.FC<SentBubbleProps> = ({
  message,
  selfName,
  selfAvatarUri,
  hideStatus,
  onQuotePress,
  onReactionPress,
}) => {
  const { colors } = useTheme();
  const d = useMemo(
    () => ({
      sentBubble: {
        backgroundColor: colors.sentBubble,
      },
      sentBubbleText: {
        color: colors.white,
        ...Typography.bodyRegular,
        lineHeight: 20,
      },
      timeText: {
        color: colors.textSecondary,
        ...Typography.tinyRegular,
        marginTop: Spacing.xs,
      },
      quoteBox: {
        backgroundColor: 'rgba(255,255,255,0.18)',
      },
      quoteText: {
        color: 'rgba(255,255,255,0.78)',
        ...Typography.tinyRegular,
      },
    }),
    [colors],
  );

  return (
    <View style={sSent.sentRow}>
      <View style={sSent.sentContent}>
        <View style={[sSent.sentBubble, d.sentBubble]}>
          {message.quotedText ? (
            onQuotePress ? (
              <Pressable
                style={[sSent.quoteBox, d.quoteBox]}
                onPress={onQuotePress}
              >
                <Text style={d.quoteText} numberOfLines={2}>{message.quotedText}</Text>
              </Pressable>
            ) : (
              <View style={[sSent.quoteBox, d.quoteBox]}>
                <Text style={d.quoteText} numberOfLines={2}>{message.quotedText}</Text>
              </View>
            )
          ) : null}
          <Text style={d.sentBubbleText}>
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
          <View style={sSent.sentTimeRow}>
            <Text style={d.timeText}>{message.time}</Text>
            {hideStatus ? null : <BubbleStatusText message={message} />}
          </View>
        ) : null}
      </View>
      <View style={sSent.sentAvatarSlot}>
        <MessageAvatar
          message={message}
          outgoing
          selfName={selfName}
          selfAvatarUri={selfAvatarUri}
        />
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
    // 自己发的气泡是实心主题紫，pill 直接叠白色半透明层（与 quoteBox 同语言）。
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  pillMine: { borderColor: '#FFFFFF' },
  pillText: { fontSize: 12, color: '#FFFFFF' },
});
