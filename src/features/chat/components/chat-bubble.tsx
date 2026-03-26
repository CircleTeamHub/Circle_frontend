import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import { Avatar } from '@/components/ui/avatar';
import type { ChatMessage } from '@/types';

interface DatePillProps {
  text: string;
}

export const DatePill: React.FC<DatePillProps> = ({ text }) => {
  const { colors } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        datePillWrapper: {
          alignItems: 'center',
        },
        datePill: {
          backgroundColor: colors.surface,
          borderRadius: Radius.md,
          paddingVertical: Spacing.xs,
          paddingHorizontal: 14,
        },
        datePillText: {
          color: colors.textSecondary,
          ...Typography.small,
        },
      }),
    [colors],
  );

  return (
    <View style={styles.datePillWrapper}>
      <View style={styles.datePill}>
        <Text style={styles.datePillText}>{text}</Text>
      </View>
    </View>
  );
};

interface ReceivedBubbleProps {
  message: ChatMessage;
  senderName?: string;
  onAvatarPress?: () => void;
}

export const ReceivedBubble: React.FC<ReceivedBubbleProps> = ({
  message,
  senderName = '陈',
  onAvatarPress,
}) => {
  const { colors } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        receivedRow: {
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: Spacing.sm,
        },
        receivedBubble: {
          backgroundColor: colors.receivedBubble,
          borderTopLeftRadius: 4,
          borderTopRightRadius: 18,
          borderBottomRightRadius: 18,
          borderBottomLeftRadius: 18,
          padding: 10,
          paddingHorizontal: 14,
          maxWidth: 260,
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
    <View style={styles.receivedRow}>
      {onAvatarPress ? (
        <Pressable onPress={onAvatarPress}>
          <Avatar size={28} name={senderName} />
        </Pressable>
      ) : (
        <Avatar size={28} name={senderName} />
      )}
      <View>
        <View style={styles.receivedBubble}>
          <Text style={styles.bubbleText}>{message.text}</Text>
        </View>
        {message.time ? (
          <Text style={styles.timeText}>{message.time}</Text>
        ) : null}
      </View>
    </View>
  );
};

interface SentBubbleProps {
  message: ChatMessage;
}

export const SentBubble: React.FC<SentBubbleProps> = ({ message }) => {
  const { colors } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        sentWrapper: {
          alignItems: 'flex-end',
        },
        sentBubble: {
          backgroundColor: colors.sentBubble,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          borderBottomRightRadius: 4,
          borderBottomLeftRadius: 18,
          padding: 10,
          paddingHorizontal: 14,
          maxWidth: 260,
        },
        sentBubbleText: {
          color: colors.white,
          ...Typography.bodyRegular,
          lineHeight: 20,
        },
        sentTimeRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.xs,
          marginTop: Spacing.xs,
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
    <View style={styles.sentWrapper}>
      <View style={styles.sentBubble}>
        <Text style={styles.sentBubbleText}>{message.text}</Text>
      </View>
      {message.time ? (
        <View style={styles.sentTimeRow}>
          <Text style={styles.timeText}>{message.time}</Text>
          <Ionicons name="checkmark-done" size={14} color={colors.sentTimeText} />
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

export const LocationCard: React.FC<LocationCardProps> = ({
  message,
  senderName = '陈',
  onAvatarPress,
}) => {
  const { colors } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        receivedRow: {
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: Spacing.sm,
        },
        locationCard: {
          backgroundColor: colors.receivedBubble,
          borderTopLeftRadius: 4,
          borderTopRightRadius: 18,
          borderBottomRightRadius: 18,
          borderBottomLeftRadius: 18,
          width: 240,
          overflow: 'hidden',
        },
        locationMapPlaceholder: {
          height: 180,
          backgroundColor: colors.surface,
          borderTopLeftRadius: 4,
          borderTopRightRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
        },
        locationInfo: {
          padding: 10,
          paddingHorizontal: 14,
        },
        locationTitle: {
          color: colors.text,
          ...Typography.bodyRegular,
          fontWeight: '600',
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
    <View style={styles.receivedRow}>
      {onAvatarPress ? (
        <Pressable onPress={onAvatarPress}>
          <Avatar size={28} name={senderName} />
        </Pressable>
      ) : (
        <Avatar size={28} name={senderName} />
      )}
      <View>
        <View style={styles.locationCard}>
          <View style={styles.locationMapPlaceholder}>
            <Ionicons name="location" size={32} color={colors.textSecondary} />
          </View>
          <View style={styles.locationInfo}>
            <Text style={styles.locationTitle}>{message.locationTitle}</Text>
            <Text style={styles.locationAddress}>{message.locationAddress}</Text>
          </View>
        </View>
        {message.time ? (
          <Text style={styles.timeText}>{message.time}</Text>
        ) : null}
      </View>
    </View>
  );
};
