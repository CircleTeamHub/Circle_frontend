import { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, type GestureResponderEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Spacing, Typography } from '@/theme';
import { Avatar } from '@/components/ui/avatar';
import type { ChatMessage } from '@/types';
import {
  AVATAR_SIZE,
  LOCATION_CARD_WIDTH,
  CHAT_CARD_PADDING_VERTICAL,
} from './shared';

interface LocationCardProps {
  message: ChatMessage;
  outgoing?: boolean;
  senderName?: string;
  senderAvatarUri?: string;
  selfName?: string;
  selfAvatarUri?: string;
  onAvatarPress?: () => void;
  onLongPress?: (event: GestureResponderEvent) => void;
}

const sLocation = StyleSheet.create({
  receivedRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  rowOutgoing: {
    justifyContent: 'flex-end',
  },
  receivedAvatarSlot: {
    paddingBottom: 2,
  },
  locationCard: {
    borderTopLeftRadius: 4,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 18,
    borderBottomLeftRadius: 18,
    width: LOCATION_CARD_WIDTH,
    overflow: 'hidden',
  },
  locationImage: {
    height: 124,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 18,
    overflow: 'hidden',
  },
  locationImageFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationCardBody: {
    maxWidth: LOCATION_CARD_WIDTH,
  },
  locationCardContent: {
    minHeight: 68,
    justifyContent: 'center',
  },
  locationInfo: {
    paddingVertical: CHAT_CARD_PADDING_VERTICAL,
    paddingHorizontal: 14,
  },
});

export const LocationCard: React.FC<LocationCardProps> = ({
  message,
  outgoing = false,
  // 同 ReceivedBubble：删除 '陈' 默认值。
  senderName = '',
  senderAvatarUri,
  selfName,
  selfAvatarUri,
  onAvatarPress,
  onLongPress,
}) => {
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      locationCard: {
        backgroundColor: colors.receivedBubble,
      },
      locationImageFallback: {
        backgroundColor: colors.surface,
      },
      locationTitle: {
        color: colors.text,
        ...Typography.bodyRegular,
        fontWeight: '600' as const,
      },
      locationAddress: {
        color: colors.textSecondary,
        ...Typography.small,
        marginTop: 2,
      },
      timeText: {
        color: colors.textSecondary,
        ...Typography.tinyRegular,
        marginTop: Spacing.xs,
      },
    }),
    [colors],
  );

  const avatarNode = (
    <Avatar
      size={AVATAR_SIZE}
      shape="square"
      name={outgoing ? selfName : senderName}
      uri={outgoing ? selfAvatarUri : senderAvatarUri}
    />
  );

  const cardNode = (
    <View style={sLocation.locationCardBody}>
      <Pressable
        style={[sLocation.locationCard, d.locationCard]}
        onLongPress={onLongPress}
        delayLongPress={350}
      >
        <View style={sLocation.locationImage}>
          <View style={[sLocation.locationImageFallback, d.locationImageFallback]}>
            <Ionicons name="location" size={32} color={colors.textSecondary} />
          </View>
        </View>
        <View style={[sLocation.locationInfo, sLocation.locationCardContent]}>
          <Text style={d.locationTitle}>{message.locationTitle}</Text>
          <Text style={d.locationAddress}>{message.locationAddress}</Text>
        </View>
      </Pressable>
      {message.time ? <Text style={d.timeText}>{message.time}</Text> : null}
    </View>
  );

  if (outgoing) {
    return (
      <View style={[sLocation.receivedRow, sLocation.rowOutgoing]}>
        {cardNode}
        <View style={sLocation.receivedAvatarSlot}>{avatarNode}</View>
      </View>
    );
  }

  return (
    <View style={sLocation.receivedRow}>
      {onAvatarPress ? (
        <Pressable style={sLocation.receivedAvatarSlot} onPress={onAvatarPress}>
          {avatarNode}
        </Pressable>
      ) : (
        <View style={sLocation.receivedAvatarSlot}>{avatarNode}</View>
      )}
      {cardNode}
    </View>
  );
};
