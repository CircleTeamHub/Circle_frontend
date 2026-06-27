import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import { Avatar } from '@/components/ui/avatar';
import type { ChatMessage, TransferCardData } from '@/types';
import {
  AVATAR_SIZE,
  BubbleStatusText,
  CHAT_CARD_STANDARD_WIDTH,
  CHAT_CARD_PADDING_VERTICAL,
  CHAT_CARD_GAP,
} from './shared';

interface TransferCardBubbleProps {
  message: ChatMessage;
  outgoing: boolean;
  senderName?: string;
  senderAvatarUri?: string;
  selfName?: string;
  selfAvatarUri?: string;
  onPress?: (data: TransferCardData) => void;
  onAvatarPress?: () => void;
  hideStatus?: boolean;
}

const TRANSFER_GOLD = '#F59E0B';

const sTransfer = StyleSheet.create({
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
    backgroundColor: TRANSFER_GOLD,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: CHAT_CARD_GAP,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  amount: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  unit: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: 'rgba(255,255,255,0.85)',
    marginLeft: 4,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  noteText: {
    ...Typography.small,
    color: '#FFFFFF',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  footer: {
    ...Typography.tinyRegular,
    color: 'rgba(255,255,255,0.85)',
  },
  avatarSlot: { paddingBottom: 2 },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
});

export const TransferCardBubble: React.FC<TransferCardBubbleProps> = ({
  message,
  outgoing,
  senderName,
  senderAvatarUri,
  selfName,
  selfAvatarUri,
  onPress,
  onAvatarPress,
  hideStatus,
}) => {
  const { colors } = useTheme();
  const data = message.transferCard;
  if (!data) return null;

  const avatarNode = (
    <Avatar
      size={AVATAR_SIZE}
      shape="square"
      name={outgoing ? selfName : senderName}
      uri={outgoing ? selfAvatarUri : senderAvatarUri}
    />
  );

  const cardNode = (
    <View style={[sTransfer.body, outgoing ? sTransfer.bodyOutgoing : null]}>
      <Pressable
        style={sTransfer.card}
        onPress={onPress ? () => onPress(data) : undefined}
      >
        <View style={sTransfer.topRow}>
          <View style={sTransfer.iconWrap}>
            <Ionicons name="cash-outline" size={20} color="#FFFFFF" />
          </View>
          <View style={sTransfer.amountRow}>
            {/* toLocaleString 自动加千分位（1000000 → 1,000,000）；
                后端上限是 1_000_000（LIMITS.TRANSFER_MAX_AMOUNT），不会出现 NaN/Infinity */}
            <Text style={sTransfer.amount}>{data.amount.toLocaleString()}</Text>
            <Text style={sTransfer.unit}>积分</Text>
          </View>
        </View>
        {data.message ? (
          <Text style={sTransfer.noteText} numberOfLines={1}>
            {data.message}
          </Text>
        ) : null}
        <View style={sTransfer.divider} />
        <Text style={sTransfer.footer}>积分转账</Text>
      </Pressable>
      {message.time ? (
        <View style={sTransfer.timeRow}>
          <Text
            style={{ ...Typography.tinyRegular, color: colors.textSecondary }}
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
      <View style={[sTransfer.row, sTransfer.rowOutgoing]}>
        {cardNode}
        <View style={sTransfer.avatarSlot}>{avatarNode}</View>
      </View>
    );
  }

  return (
    <View style={sTransfer.row}>
      {onAvatarPress ? (
        <Pressable style={sTransfer.avatarSlot} onPress={onAvatarPress}>
          {avatarNode}
        </Pressable>
      ) : (
        <View style={sTransfer.avatarSlot}>{avatarNode}</View>
      )}
      {cardNode}
    </View>
  );
};
