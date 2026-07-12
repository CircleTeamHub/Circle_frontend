import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const NOTICE_DURATION_MS = 4_000;

const s = StyleSheet.create({
  container: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    bottom: 76,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.lg,
    zIndex: 20,
  },
  text: {
    ...Typography.caption,
    textAlign: 'center',
  },
});

export function MomentMentionNotice({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();

  useEffect(() => {
    if (!message) return;
    const timeout = setTimeout(onDismiss, NOTICE_DURATION_MS);
    return () => clearTimeout(timeout);
  }, [message, onDismiss]);

  if (!message) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityRole="alert"
      style={[s.container, { backgroundColor: colors.surface }]}
    >
      <Text style={[s.text, { color: colors.text }]}>{message}</Text>
    </View>
  );
}
