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

// 悬浮在图片/视频左上角的小胶囊：离边 8pt，不再是贴死在角上的大方块。
const s = StyleSheet.create({
  badge: {
    maxWidth: '75%',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    overflow: 'hidden',
    ...Typography.small,
    lineHeight: 16,
    fontWeight: '600',
  },
  overlay: { position: 'absolute', top: Spacing.sm, left: Spacing.sm, zIndex: 1 },
  inline: { alignSelf: 'flex-start', marginBottom: Spacing.xs },
});
