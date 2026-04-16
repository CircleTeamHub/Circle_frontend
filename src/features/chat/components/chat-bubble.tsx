import { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import { Avatar } from '@/components/ui/avatar';
import type { ChatMessage } from '@/types';

interface DatePillProps {
  text: string;
}

const sDatePill = StyleSheet.create({
  datePillWrapper: {
    alignItems: 'center',
  },
  datePill: {
    borderRadius: Radius.md,
    paddingVertical: Spacing.xs,
    paddingHorizontal: 14,
  },
});

export const DatePill: React.FC<DatePillProps> = ({ text }) => {
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      datePill: {
        backgroundColor: colors.surface,
      },
      datePillText: {
        color: colors.textSecondary,
        ...Typography.small,
      },
    }),
    [colors],
  );

  return (
    <View style={sDatePill.datePillWrapper}>
      <View style={[sDatePill.datePill, d.datePill]}>
        <Text style={d.datePillText}>{text}</Text>
      </View>
    </View>
  );
};

interface ReceivedBubbleProps {
  message: ChatMessage;
  senderName?: string;
  onAvatarPress?: () => void;
}

const sReceived = StyleSheet.create({
  receivedRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  receivedBubble: {
    borderTopLeftRadius: 4,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 18,
    borderBottomLeftRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
    maxWidth: 280,
  },
  receivedContent: {
    maxWidth: 280,
  },
  receivedAvatarSlot: {
    paddingBottom: 2,
  },
});

export const ReceivedBubble: React.FC<ReceivedBubbleProps> = ({
  message,
  senderName = '陈',
  onAvatarPress,
}) => {
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      receivedBubble: {
        backgroundColor: colors.receivedBubble,
      },
      bubbleText: {
        color: colors.text,
        ...Typography.bodyRegular,
        lineHeight: 20,
      },
      timeText: {
        color: colors.textSecondary,
        ...Typography.tinyRegular,
        marginTop: Spacing.xs,
      },
    }),
    [colors],
  );

  return (
    <View style={sReceived.receivedRow}>
      {onAvatarPress ? (
        <Pressable style={sReceived.receivedAvatarSlot} onPress={onAvatarPress}>
          <Avatar size={28} name={senderName} />
        </Pressable>
      ) : (
        <View style={sReceived.receivedAvatarSlot}>
          <Avatar size={28} name={senderName} />
        </View>
      )}
      <View style={sReceived.receivedContent}>
        <View style={[sReceived.receivedBubble, d.receivedBubble]}>
          <Text style={d.bubbleText}>{message.text}</Text>
        </View>
        {message.time ? (
          <Text style={d.timeText}>{message.time}</Text>
        ) : null}
      </View>
    </View>
  );
};

interface SentBubbleProps {
  message: ChatMessage;
}

const sSent = StyleSheet.create({
  sentWrapper: {
    alignItems: 'flex-end',
  },
  sentBubble: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 4,
    borderBottomLeftRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
    maxWidth: 280,
  },
  sentTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  sentStatusIcon: {
    marginTop: 1,
  },
});

export const SentBubble: React.FC<SentBubbleProps> = ({ message }) => {
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      sentBubble: {
        backgroundColor: colors.sentBubble,
      },
      sentBubbleText: {
        color: colors.white,
        ...Typography.bodyRegular,
        lineHeight: 20,
      },
      timeText: {
        color: colors.textSecondary,
        ...Typography.tinyRegular,
        marginTop: Spacing.xs,
      },
    }),
    [colors],
  );

  return (
    <View style={sSent.sentWrapper}>
      <View style={[sSent.sentBubble, d.sentBubble]}>
        <Text style={d.sentBubbleText}>{message.text}</Text>
      </View>
      {message.time ? (
        <View style={sSent.sentTimeRow}>
          <Text style={d.timeText}>{message.time}</Text>
          <Ionicons
            style={sSent.sentStatusIcon}
            name="checkmark-done"
            size={14}
            color={colors.sentTimeText}
          />
        </View>
      ) : null}
    </View>
  );
};

interface LocationCardProps {
  message: ChatMessage;
  senderName?: string;
  onAvatarPress?: () => void;
}

const sLocation = StyleSheet.create({
  receivedRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  locationCard: {
    borderTopLeftRadius: 4,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 18,
    borderBottomLeftRadius: 18,
    width: 248,
    overflow: 'hidden',
  },
  locationImage: {
    height: 156,
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
    maxWidth: 248,
  },
  locationCardContent: {
    minHeight: 88,
    justifyContent: 'center',
  },
  locationInfo: {
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
});

export const LocationCard: React.FC<LocationCardProps> = ({
  message,
  senderName = '陈',
  onAvatarPress,
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

  return (
    <View style={sLocation.receivedRow}>
      {onAvatarPress ? (
        <Pressable onPress={onAvatarPress}>
          <Avatar size={28} name={senderName} />
        </Pressable>
      ) : (
        <View style={sReceived.receivedAvatarSlot}>
          <Avatar size={28} name={senderName} />
        </View>
      )}
      <View style={sLocation.locationCardBody}>
        <View style={[sLocation.locationCard, d.locationCard]}>
          <View style={sLocation.locationImage}>
            <View style={[sLocation.locationImageFallback, d.locationImageFallback]}>
              <Ionicons name="location" size={32} color={colors.textSecondary} />
            </View>
          </View>
          <View style={[sLocation.locationInfo, sLocation.locationCardContent]}>
            <Text style={d.locationTitle}>{message.locationTitle}</Text>
            <Text style={d.locationAddress}>{message.locationAddress}</Text>
          </View>
        </View>
        {message.time ? (
          <Text style={d.timeText}>{message.time}</Text>
        ) : null}
      </View>
    </View>
  );
};
