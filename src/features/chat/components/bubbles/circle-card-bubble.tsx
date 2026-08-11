import { useTranslation } from 'react-i18next';
import type { GestureResponderEvent } from 'react-native';
import { Radius } from '@/theme';
import { CircleAvatar } from '@/components/ui/circle-avatar';
import type { ChatMessage, CircleCardData } from '@/types';
import { CompactCardBubble, MessageAvatar } from './shared';

interface CircleCardBubbleProps {
  message: ChatMessage;
  outgoing: boolean;
  senderName?: string;
  senderAvatarUri?: string;
  selfName?: string;
  selfAvatarUri?: string;
  onPress?: (card: CircleCardData) => void;
  onAvatarPress?: () => void;
  onLongPress?: (event: GestureResponderEvent) => void;
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
  onLongPress,
  hideStatus,
}) => {
  const { t } = useTranslation();
  const card = message.circleCard;

  if (!card) return null;

  const displayName = card.name;
  const displayAvatar = card.avatarUrl;

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
      onLongPress={onLongPress}
      hideStatus={hideStatus}
    />
  );
};
