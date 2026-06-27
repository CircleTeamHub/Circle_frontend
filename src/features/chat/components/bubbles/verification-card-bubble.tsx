import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Avatar } from '@/components/ui/avatar';
import type { ChatMessage, VerificationCardData } from '@/types';
import { AVATAR_SIZE, CompactCardBubble, sCircleCard } from './shared';

interface VerificationCardBubbleProps {
  message: ChatMessage;
  outgoing: boolean;
  senderName?: string;
  senderAvatarUri?: string;
  selfName?: string;
  selfAvatarUri?: string;
  onPress?: (card: VerificationCardData) => void;
  onAvatarPress?: () => void;
  hideStatus?: boolean;
}

// Circle-verification invite card — sent when an applicant adds you as a
// verifier. Tapping opens the verify screen to approve/reject. Reuses the
// shared compact-card layout with a shield icon as the leading visual.
export const VerificationCardBubble: React.FC<VerificationCardBubbleProps> = ({
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
  const { t } = useTranslation();
  const card = message.verificationCard;

  if (!card) return null;

  const avatarNode = (
    <Avatar
      size={AVATAR_SIZE}
      shape="square"
      name={outgoing ? selfName : senderName}
      uri={outgoing ? selfAvatarUri : senderAvatarUri}
    />
  );

  const iconBg = outgoing ? 'rgba(255,255,255,0.2)' : colors.primaryLight;

  return (
    <CompactCardBubble
      message={message}
      outgoing={outgoing}
      avatarNode={avatarNode}
      leading={
        <View style={[sCircleCard.leadingIcon, { backgroundColor: iconBg }]}>
          <Ionicons
            name="shield-checkmark"
            size={26}
            color={outgoing ? colors.white : colors.primary}
          />
        </View>
      }
      title={t('invitation.cardTitle', {
        name: card.applicantName,
        defaultValue: '{{name}} 邀请你帮忙验证',
      })}
      subtitle={t('invitation.cardCircle', {
        circle: card.circleName,
        defaultValue: '加入「{{circle}}」的入圈担保',
      })}
      footer={t('invitation.cardFooter', { defaultValue: '点击为 TA 验证' })}
      onPress={onPress ? () => onPress(card) : undefined}
      onAvatarPress={onAvatarPress}
      hideStatus={hideStatus}
    />
  );
};
