import { useTranslation } from 'react-i18next';
import { Radius } from '@/theme';
import { Avatar } from '@/components/ui/avatar';
import { CircleAvatar } from '@/components/ui/circle-avatar';
import type { ChatMessage, CircleCardData } from '@/types';
import { AVATAR_SIZE, CompactCardBubble } from './shared';

interface CircleCardBubbleProps {
  message: ChatMessage;
  outgoing: boolean;
  senderName?: string;
  senderAvatarUri?: string;
  selfName?: string;
  selfAvatarUri?: string;
  onPress?: (card: CircleCardData) => void;
  onAvatarPress?: () => void;
  hideStatus?: boolean;
}

// Circle share card — compact card layout. Tapping opens the circle detail,
// which owns live circle fetching and join checks.
export const CircleCardBubble: React.FC<CircleCardBubbleProps> = ({
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
  const { t } = useTranslation();
  const card = message.circleCard;

  if (!card) return null;

  const displayName = card.name;
  const displayAvatar = card.avatarUrl;

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
        <CircleAvatar uri={displayAvatar} size={48} borderRadius={Radius.sm} />
      }
      title={displayName}
      subtitle={t('circle.card.type')}
      footer={t('circle.card.footer')}
      onPress={onPress ? () => onPress(card) : undefined}
      onAvatarPress={onAvatarPress}
      hideStatus={hideStatus}
    />
  );
};
