import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type GestureResponderEvent } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Avatar } from '@/components/ui/avatar';
import { CircleAvatar } from '@/components/ui/circle-avatar';
import { GroupChatAvatar } from '@/components/ui/group-chat-avatar';
import { buildQrUrl } from '@/features/qr/qr-payload';
import { Radius, Spacing } from '@/theme';
import type { ChatMessage, QrCardData, QrCardType } from '@/types';
import { CompactCardBubble, MessageAvatar } from './shared';

interface QrCardBubbleProps {
  message: ChatMessage;
  outgoing: boolean;
  senderName?: string;
  senderAvatarUri?: string;
  selfName?: string;
  selfAvatarUri?: string;
  onPress?: (card: QrCardData) => void;
  onAvatarPress?: () => void;
  onLongPress?: (event: GestureResponderEvent) => void;
  hideStatus?: boolean;
}

/** 卡片里的码画多大 —— 卡片宽 260,扣掉两侧 padding 后还留出白边。 */
const QR_SIZE = 140;

/** 二维码永远是黑白的:白底不跟随主题,否则暗色下深底深码直接扫不出来。 */
const QR_DARK = '#111111';
const QR_LIGHT = '#FFFFFF';

const TYPE_LABEL_KEY: Record<QrCardType, string> = {
  user: 'qr.card.userType',
  group: 'qr.card.groupType',
  circle: 'qr.card.circleType',
};

const TYPE_FOOTER_KEY: Record<QrCardType, string> = {
  user: 'qr.card.userFooter',
  group: 'qr.card.groupFooter',
  circle: 'qr.card.circleFooter',
};

const TYPE_LABEL_FALLBACK: Record<QrCardType, string> = {
  user: '个人名片二维码',
  group: '群聊二维码',
  circle: '圈子二维码',
};

const TYPE_FOOTER_FALLBACK: Record<QrCardType, string> = {
  user: '扫一扫或点击加好友',
  group: '扫一扫或点击加入群聊',
  circle: '扫一扫或点击加入圈子',
};

/**
 * 二维码分享卡 —— 名片 / 群 / 圈子三种码共用。
 *
 * 早先是把二维码当普通图片消息发过去,收方只看到一张孤零零的黑白方块,
 * 既不知道是谁的码、也不知道扫了会发生什么,更没法在同一台手机上扫自己的屏幕。
 * 现在发的是卡片:头像 + 名字 + 「这是什么码」写在脸上,码由本端按令牌就地渲染
 * (载荷里只有令牌,见 QrCardData.token),点一下直接进 /qr 落地页,连扫都不用扫。
 */
export const QrCardBubble: React.FC<QrCardBubbleProps> = ({
  message,
  outgoing,
  senderName,
  senderAvatarUri,
  selfName,
  selfAvatarUri,
  onPress,
  onAvatarPress,
  onLongPress,
  hideStatus,
}) => {
  const { t } = useTranslation();
  const card = message.qrCard;

  if (!card || !card.token) return null;

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

  const leading =
    card.qrType === 'group' ? (
      <GroupChatAvatar size={48} name={card.name} uri={card.avatarUrl} />
    ) : card.qrType === 'circle' ? (
      <CircleAvatar uri={card.avatarUrl} size={48} borderRadius={Radius.sm} />
    ) : (
      <Avatar size={48} name={card.name} uri={card.avatarUrl ?? undefined} />
    );

  return (
    <CompactCardBubble
      message={message}
      outgoing={outgoing}
      avatarNode={avatarNode}
      leading={leading}
      title={card.name}
      subtitle={t(TYPE_LABEL_KEY[card.qrType], {
        defaultValue: TYPE_LABEL_FALLBACK[card.qrType],
      })}
      media={
        <View style={s.qrPlate}>
          <QRCode
            value={buildQrUrl(card.token)}
            size={QR_SIZE}
            color={QR_DARK}
            backgroundColor={QR_LIGHT}
          />
        </View>
      }
      footer={t(TYPE_FOOTER_KEY[card.qrType], {
        defaultValue: TYPE_FOOTER_FALLBACK[card.qrType],
      })}
      onPress={onPress ? () => onPress(card) : undefined}
      onAvatarPress={onAvatarPress}
      onLongPress={onLongPress}
      hideStatus={hideStatus}
    />
  );
};

const s = StyleSheet.create({
  qrPlate: {
    backgroundColor: QR_LIGHT,
    borderRadius: Radius.sm,
    padding: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
