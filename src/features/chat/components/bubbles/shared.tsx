import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import type { ChatMessage } from '@/types';

export const AVATAR_SIZE = 36;
export const CHAT_CARD_STANDARD_WIDTH = 260;
export const LOCATION_CARD_WIDTH = 248;
export const CHAT_CARD_PADDING_VERTICAL = 10;
export const CHAT_CARD_GAP = 8;

interface BubbleStatusTextProps {
  message: ChatMessage;
}

/**
 * 自己发出去的消息底下显示状态文字：发送中 / 未读 / 已读 / 发送失败。
 * 接收消息不显示状态。
 */
export const BubbleStatusText: React.FC<BubbleStatusTextProps> = ({ message }) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { sendStatus, isRead } = message;
  let text: string;
  let color = colors.textSecondary;
  if (sendStatus === 1) {
    text = t('chat.message.sending', { defaultValue: '发送中' });
  } else if (sendStatus === 3) {
    text = t('chat.message.sendFailed', { defaultValue: '发送失败' });
    color = colors.error;
  } else if (isRead) {
    text = t('chat.message.read', { defaultValue: '已读' });
  } else {
    text = t('chat.message.unread', { defaultValue: '未读' });
  }
  return (
    <Text style={{ ...Typography.tinyRegular, color, marginLeft: 4 }}>
      {text}
    </Text>
  );
};

export const sFriendCard = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  rowOutgoing: { justifyContent: 'flex-end' },
  body: { maxWidth: CHAT_CARD_STANDARD_WIDTH },
  bodyOutgoing: { alignItems: 'flex-end' },
  card: {
    width: CHAT_CARD_STANDARD_WIDTH,
    borderRadius: Radius.md,
    paddingVertical: CHAT_CARD_PADDING_VERTICAL,
    paddingHorizontal: Spacing.md,
    gap: CHAT_CARD_GAP,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: CHAT_CARD_GAP,
  },
  textCol: { flex: 1, gap: 1 },
  nickname: { ...Typography.body, fontWeight: '600' },
  persona: { ...Typography.small, lineHeight: 17 },
  iconsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  iconChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Radius.full,
    gap: 4,
  },
  iconImage: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  iconLabel: { ...Typography.tiny, fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth, marginTop: 2 },
  footer: { ...Typography.tinyRegular, paddingTop: 1 },
  avatarSlot: { paddingBottom: 2 },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
});

export const sCircleCard = StyleSheet.create({
  row: sFriendCard.row,
  rowOutgoing: sFriendCard.rowOutgoing,
  body: { maxWidth: CHAT_CARD_STANDARD_WIDTH },
  bodyOutgoing: sFriendCard.bodyOutgoing,
  card: {
    width: CHAT_CARD_STANDARD_WIDTH,
    borderRadius: Radius.md,
    paddingVertical: CHAT_CARD_PADDING_VERTICAL,
    paddingHorizontal: Spacing.md,
    gap: CHAT_CARD_GAP,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: CHAT_CARD_GAP,
  },
  textCol: { flex: 1, gap: 1 },
  nickname: { ...Typography.body, fontWeight: '600' },
  persona: { ...Typography.small, lineHeight: 17 },
  divider: { height: StyleSheet.hairlineWidth, marginTop: 2 },
  footer: { ...Typography.tinyRegular, paddingTop: 1 },
  avatarSlot: sFriendCard.avatarSlot,
  timeRow: sFriendCard.timeRow,
  leadingIcon: {
    width: 48,
    height: 48,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export interface CompactCardBubbleProps {
  message: ChatMessage;
  outgoing: boolean;
  // 48×48 leading visual: a circle avatar, a friend avatar, or an icon tile.
  leading: React.ReactNode;
  title: string;
  subtitle: string;
  footer: string;
  // The small sender/self avatar shown beside the bubble (AVATAR_SIZE).
  avatarNode: React.ReactNode;
  onPress?: () => void;
  onAvatarPress?: () => void;
  hideStatus?: boolean;
}

// Shared compact-card scaffold for circle-share and verification-invite cards.
// Both render the same row/divider/footer/time layout (sCircleCard); only the
// leading visual and the three text slots differ, so they pass those in.
export const CompactCardBubble: React.FC<CompactCardBubbleProps> = ({
  message,
  outgoing,
  leading,
  title,
  subtitle,
  footer,
  avatarNode,
  onPress,
  onAvatarPress,
  hideStatus,
}) => {
  const { colors } = useTheme();

  const cardBg = outgoing ? colors.sentBubble : colors.receivedBubble;
  const onCardColor = outgoing ? colors.white : colors.text;
  const onCardSecondary = outgoing
    ? 'rgba(255,255,255,0.78)'
    : colors.textSecondary;
  const dividerColor = outgoing ? 'rgba(255,255,255,0.25)' : colors.divider;

  const cardNode = (
    <View style={[sCircleCard.body, outgoing ? sCircleCard.bodyOutgoing : null]}>
      <Pressable
        style={[sCircleCard.card, { backgroundColor: cardBg }]}
        onPress={onPress}
      >
        <View style={sCircleCard.topRow}>
          {leading}
          <View style={sCircleCard.textCol}>
            <Text
              style={[sCircleCard.nickname, { color: onCardColor }]}
              numberOfLines={1}
            >
              {title}
            </Text>
            <Text
              style={[sCircleCard.persona, { color: onCardSecondary }]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          </View>
        </View>
        <View style={[sCircleCard.divider, { backgroundColor: dividerColor }]} />
        <Text style={[sCircleCard.footer, { color: onCardSecondary }]}>
          {footer}
        </Text>
      </Pressable>

      {message.time ? (
        <View style={sCircleCard.timeRow}>
          <Text
            style={{ ...Typography.tinyRegular, color: colors.textSecondary }}
          >
            {message.time}
          </Text>
          {outgoing && !hideStatus ? (
            <BubbleStatusText message={message} />
          ) : null}
        </View>
      ) : null}
    </View>
  );

  if (outgoing) {
    return (
      <View style={[sCircleCard.row, sCircleCard.rowOutgoing]}>
        {cardNode}
        <View style={sCircleCard.avatarSlot}>{avatarNode}</View>
      </View>
    );
  }

  return (
    <View style={sCircleCard.row}>
      {onAvatarPress ? (
        <Pressable style={sCircleCard.avatarSlot} onPress={onAvatarPress}>
          {avatarNode}
        </Pressable>
      ) : (
        <View style={sCircleCard.avatarSlot}>{avatarNode}</View>
      )}
      {cardNode}
    </View>
  );
};
