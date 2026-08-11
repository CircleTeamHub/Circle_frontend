import {
  View,
  Text,
  StyleSheet,
  Pressable,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import { Avatar } from '@/components/ui/avatar';
import { getAvatarFrameSource } from '@/features/profile/membership-frames';
import { useAuthStore } from '@/stores/authStore';
import { useUserAppearance } from '@/stores/userAppearanceStore';
import type { ChatMessage } from '@/types';

export const AVATAR_SIZE = 36;
export const CHAT_CARD_STANDARD_WIDTH = 260;
export const LOCATION_CARD_WIDTH = 248;
export const CHAT_CARD_PADDING_VERTICAL = 10;
export const CHAT_CARD_GAP = 8;

interface MessageAvatarProps {
  message: ChatMessage;
  outgoing: boolean;
  selfName?: string;
  selfAvatarUri?: string;
  senderName?: string;
  senderAvatarUri?: string;
}

/**
 * 消息行左/右侧的那颗头像 —— **所有气泡类型必须共用这一个**。
 *
 * 原来只有文字气泡(sent/received)带头像框、且是圆形,图片/语音/位置/通话记录
 * 和六种卡片各自渲染一颗方形、不带框的头像:同一个人在同一个会话里,
 * 发文字是「圆形+头像框」、发卡片就变成「方形无框」,看起来像两个人。
 * 头像框还是会员付费权益,只在 12 个气泡里的 2 个上生效更不能接受。
 *
 * 自己的框取 authStore(权威且实时),对端的走 useUserAppearance 异步补查。
 */
export const MessageAvatar: React.FC<MessageAvatarProps> = ({
  message,
  outgoing,
  selfName,
  selfAvatarUri,
  senderName,
  senderAvatarUri,
}) => {
  const selfFrame = useAuthStore((state) => state.user?.avatarFrameAppearance);
  // 接收消息只有 senderID;外观缓存会批量补查并在权威结果返回后刷新头像框。
  const senderAppearance = useUserAppearance(
    outgoing ? undefined : message.senderID,
  );
  const frame = outgoing ? selfFrame : senderAppearance?.avatarFrame;
  return (
    <Avatar
      size={AVATAR_SIZE}
      name={outgoing ? selfName : senderName}
      uri={outgoing ? selfAvatarUri : senderAvatarUri}
      frameSource={getAvatarFrameSource(frame) ?? undefined}
      compactFrame
    />
  );
};

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
  const { sendStatus, isRead, isDelivered } = message;
  let text: string;
  let color = colors.textSecondary;
  if (sendStatus === 1) {
    text = t('chat.message.sending', { defaultValue: '发送中' });
  } else if (sendStatus === 3) {
    text = t('chat.message.sendFailed', { defaultValue: '发送失败' });
    color = colors.error;
  } else if (isRead) {
    text = t('chat.message.read', { defaultValue: '已读' });
  } else if (isDelivered) {
    // G-07 送达回执:对端设备收到了但还没读。
    text = t('chat.message.delivered', { defaultValue: '已送达' });
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

// 卡片气泡通用外壳样式：左右方向布局、头像位、底部时间/状态行。
// 由 CardBubbleFrame 使用；圈子卡 / 帖子卡 / verification 卡共享同一外壳，
// 只是卡片本体各不相同。
export const sCardFrame = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  rowOutgoing: { justifyContent: 'flex-end' },
  body: {},
  bodyOutgoing: { alignItems: 'flex-end' },
  avatarSlot: { paddingBottom: 2 },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
});

export const sCircleCard = StyleSheet.create({
  body: { maxWidth: CHAT_CARD_STANDARD_WIDTH },
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
  leadingIcon: {
    width: 48,
    height: 48,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export interface CardBubbleFrameProps {
  message: ChatMessage;
  outgoing: boolean;
  // 卡片旁的小头像（发送者 / 自己），尺寸 AVATAR_SIZE。
  avatarNode: React.ReactNode;
  onAvatarPress?: () => void;
  hideStatus?: boolean;
  // 约束卡片本体宽度 / 对齐的 body 容器样式（各卡片传入自己的 maxWidth）。
  bodyStyle?: StyleProp<ViewStyle>;
  // 卡片本体（通常是一个可点的 Pressable 卡片）。
  children: React.ReactNode;
}

// 卡片气泡外壳：负责头像行、左右方向布局、底部时间 + 发送状态。
// 卡片本体（children）由各卡片自定义，从而在共享外壳下拥有各自的视觉：
// 圈子卡 / verification 卡走紧凑气泡（CompactCardBubble），帖子卡走海报卡。
export const CardBubbleFrame: React.FC<CardBubbleFrameProps> = ({
  message,
  outgoing,
  avatarNode,
  onAvatarPress,
  hideStatus,
  bodyStyle,
  children,
}) => {
  const { colors } = useTheme();

  const body = (
    <View
      style={[
        sCardFrame.body,
        outgoing ? sCardFrame.bodyOutgoing : null,
        bodyStyle,
      ]}
    >
      {children}

      {message.time ? (
        <View style={sCardFrame.timeRow}>
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
      <View style={[sCardFrame.row, sCardFrame.rowOutgoing]}>
        {body}
        <View style={sCardFrame.avatarSlot}>{avatarNode}</View>
      </View>
    );
  }

  return (
    <View style={sCardFrame.row}>
      {onAvatarPress ? (
        <Pressable style={sCardFrame.avatarSlot} onPress={onAvatarPress}>
          {avatarNode}
        </Pressable>
      ) : (
        <View style={sCardFrame.avatarSlot}>{avatarNode}</View>
      )}
      {body}
    </View>
  );
};

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
  onLongPress?: (event: GestureResponderEvent) => void;
  hideStatus?: boolean;
}

// Shared compact-card scaffold for circle-share and verification-invite cards.
// Both render the same topRow/divider/footer layout (sCircleCard) inside the
// common CardBubbleFrame; only the leading visual and three text slots differ.
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
  onLongPress,
  hideStatus,
}) => {
  const { colors } = useTheme();

  const cardBg = outgoing ? colors.sentBubble : colors.receivedBubble;
  const onCardColor = outgoing ? colors.white : colors.text;
  const onCardSecondary = outgoing
    ? 'rgba(255,255,255,0.78)'
    : colors.textSecondary;
  const dividerColor = outgoing ? 'rgba(255,255,255,0.25)' : colors.divider;

  return (
    <CardBubbleFrame
      message={message}
      outgoing={outgoing}
      avatarNode={avatarNode}
      onAvatarPress={onAvatarPress}
      hideStatus={hideStatus}
      bodyStyle={sCircleCard.body}
    >
      <Pressable
        style={[sCircleCard.card, { backgroundColor: cardBg }]}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={350}
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
    </CardBubbleFrame>
  );
};
