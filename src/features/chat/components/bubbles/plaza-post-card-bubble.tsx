import { useTranslation } from 'react-i18next';
import type { GestureResponderEvent } from 'react-native';
import { Radius } from '@/theme';
import { Avatar } from '@/components/ui/avatar';
import { CircleAvatar } from '@/components/ui/circle-avatar';
import type { ChatMessage, PlazaPostCardData } from '@/types';
import { AVATAR_SIZE, CompactCardBubble } from './shared';

interface PlazaPostCardBubbleProps {
  message: ChatMessage;
  outgoing: boolean;
  senderName?: string;
  senderAvatarUri?: string;
  selfName?: string;
  selfAvatarUri?: string;
  onPress?: (card: PlazaPostCardData) => void;
  onAvatarPress?: () => void;
  onLongPress?: (event: GestureResponderEvent) => void;
  hideStatus?: boolean;
}

// Circle plaza-post share card — compact card layout. Tapping opens the post
// detail (which owns live fetching + deleted/expired fallbacks).
export const PlazaPostCardBubble: React.FC<PlazaPostCardBubbleProps> = ({
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
  const card = message.plazaPostCard;

  if (!card) return null;

  const subtitle = card.city
    ? `${card.circleName} · ${card.city}`
    : card.circleName;

  const avatarNode = (
    <Avatar
      size={AVATAR_SIZE}
      shape="square"
      name={outgoing ? selfName : senderName}
      uri={outgoing ? selfAvatarUri : senderAvatarUri}
    />
  );

  return (
    <CompactCardBubble
      message={message}
      outgoing={outgoing}
      avatarNode={avatarNode}
      leading={
        <CircleAvatar uri={card.coverUrl} size={48} borderRadius={Radius.sm} />
      }
      title={card.title}
      subtitle={subtitle}
      footer={t('chat.plazaPostCard.footer', {
        count: card.signupCount,
        author: card.authorNickname,
        defaultValue: '报名 {{count}} · {{author}}',
      })}
      onPress={onPress ? () => onPress(card) : undefined}
      onAvatarPress={onAvatarPress}
      onLongPress={onLongPress}
      hideStatus={hideStatus}
    />
  );
};
