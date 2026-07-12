import { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme, Spacing, Typography } from '@/theme';

interface SystemNoticePillProps {
  text: string;
}

const sSystemNotice = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
});

/**
 * Centered, subtle system line for conversation events (e.g. OpenIM's
 * FriendAdded → 「你们已经是好友了，开始聊天吧」). Deliberately not a bubble —
 * it reads as a system notice, so it never looks like a duplicate of the real
 * greeting messages the backend seeds.
 */
export const SystemNoticePill: React.FC<SystemNoticePillProps> = ({ text }) => {
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      noticeText: {
        color: colors.textSecondary,
        textAlign: 'center' as const,
        ...Typography.small,
      },
    }),
    [colors],
  );

  return (
    <View style={sSystemNotice.wrapper}>
      <Text style={d.noticeText}>{text}</Text>
    </View>
  );
};
