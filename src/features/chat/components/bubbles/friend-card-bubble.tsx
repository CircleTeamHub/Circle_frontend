import { View, Text, Pressable, type GestureResponderEvent } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme, Typography } from '@/theme';
import { Avatar } from '@/components/ui/avatar';
import { resolveFallbackIcon } from '@/components/ui/user-icon-row';
import type { ChatMessage, FriendCardData } from '@/types';
import { AVATAR_SIZE, BubbleStatusText, sFriendCard } from './shared';

interface FriendCardBubbleProps {
  message: ChatMessage;
  outgoing: boolean;
  senderName?: string;
  senderAvatarUri?: string;
  selfName?: string;
  selfAvatarUri?: string;
  onPress?: (card: FriendCardData) => void;
  onAvatarPress?: () => void;
  onLongPress?: (event: GestureResponderEvent) => void;
  hideStatus?: boolean;
}

export const FriendCardBubble: React.FC<FriendCardBubbleProps> = ({
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
  const { colors } = useTheme();
  const { t } = useTranslation();
  const card = message.friendCard;
  if (!card) return null;

  const avatarNode = (
    <Avatar
      size={AVATAR_SIZE}
      shape="square"
      name={outgoing ? selfName : senderName}
      uri={outgoing ? selfAvatarUri : senderAvatarUri}
    />
  );

  const cardBg = outgoing ? colors.sentBubble : colors.receivedBubble;
  const onCardColor = outgoing ? colors.white : colors.text;
  const onCardSecondary = outgoing
    ? 'rgba(255,255,255,0.78)'
    : colors.textSecondary;
  const dividerColor = outgoing ? 'rgba(255,255,255,0.25)' : colors.divider;

  const cardNode = (
    <View style={[sFriendCard.body, outgoing ? sFriendCard.bodyOutgoing : null]}>
      <Pressable
        style={[sFriendCard.card, { backgroundColor: cardBg }]}
        onPress={onPress ? () => onPress(card) : undefined}
        onLongPress={onLongPress}
        delayLongPress={350}
      >
        <View style={sFriendCard.topRow}>
          <Avatar
            size={48}
            shape="square"
            name={card.nickname}
            uri={card.faceURL || undefined}
          />
          <View style={sFriendCard.textCol}>
            <Text
              style={[sFriendCard.nickname, { color: onCardColor }]}
              numberOfLines={1}
            >
              {card.nickname}
            </Text>
            <Text
              style={[sFriendCard.persona, { color: onCardSecondary }]}
              numberOfLines={1}
            >
              {card.persona?.trim() ||
                t('chat.friendCard.noPersona', {
                  defaultValue: '这个人很懒，什么都没留下',
                })}
            </Text>
          </View>
        </View>
        {card.displayIcons && card.displayIcons.length > 0 ? (
          <View style={sFriendCard.iconsRow}>
            {card.displayIcons.slice(0, 4).map((icon) => {
              const iconBg = outgoing ? 'rgba(255,255,255,0.18)' : colors.surface;
              return (
                <View
                  key={icon.id}
                  style={[sFriendCard.iconChip, { backgroundColor: iconBg }]}
                >
                  {icon.imageUrl ? (
                    <Image
                      source={{ uri: icon.imageUrl }}
                      style={sFriendCard.iconImage}
                      contentFit="cover"
                    />
                  ) : (
                    <Ionicons
                      name={resolveFallbackIcon(
                        icon.fallbackIconName,
                        'ribbon-outline',
                      )}
                      size={14}
                      color={onCardColor}
                    />
                  )}
                  <Text
                    style={[sFriendCard.iconLabel, { color: onCardColor }]}
                    numberOfLines={1}
                  >
                    {icon.title}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : null}
        <View style={[sFriendCard.divider, { backgroundColor: dividerColor }]} />
        <Text style={[sFriendCard.footer, { color: onCardSecondary }]}>
          {t('chat.friendCard.label', { defaultValue: '个人名片' })}
        </Text>
      </Pressable>

      {message.time ? (
        <View style={sFriendCard.timeRow}>
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
      <View style={[sFriendCard.row, sFriendCard.rowOutgoing]}>
        {cardNode}
        <View style={sFriendCard.avatarSlot}>{avatarNode}</View>
      </View>
    );
  }

  return (
    <View style={sFriendCard.row}>
      {onAvatarPress ? (
        <Pressable style={sFriendCard.avatarSlot} onPress={onAvatarPress}>
          {avatarNode}
        </Pressable>
      ) : (
        <View style={sFriendCard.avatarSlot}>{avatarNode}</View>
      )}
      {cardNode}
    </View>
  );
};
