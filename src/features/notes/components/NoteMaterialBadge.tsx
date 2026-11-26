import { StyleSheet, Text } from 'react-native';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

export function NoteMaterialBadge({ label, showcase = false, overlay = true }: {
  label: string;
  showcase?: boolean;
  overlay?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Text
      testID="note-material-badge"
      pointerEvents="none"
      style={[
        s.badge,
        overlay ? s.overlay : s.inline,
        { backgroundColor: showcase ? colors.success : colors.primary, color: showcase ? colors.black : colors.white },
      ]}
    >
      {label}
    </Text>
  );
}

const s = StyleSheet.create({
  badge: {
    maxWidth: '75%',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderBottomRightRadius: Radius.xs,
    ...Typography.body,
    fontWeight: '600',
  },
  overlay: { position: 'absolute', top: 0, left: 0, zIndex: 1 },
  inline: { alignSelf: 'flex-start', marginBottom: Spacing.xs, borderRadius: Radius.xs },
});
