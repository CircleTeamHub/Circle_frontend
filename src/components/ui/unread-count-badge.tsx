import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useTheme } from '@/theme';

const MAX_FONT_SIZE_MULTIPLIER = 2;

const s = StyleSheet.create({
  badge: {
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  text: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '600',
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
});

export function UnreadCountBadge({ count, testID }: { count: number; testID?: string }) {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const fontMultiplier = Math.max(1, Math.min(fontScale, MAX_FONT_SIZE_MULTIPLIER));
  const minimumSize = Math.ceil(14 * fontMultiplier + 2);

  if (count <= 0) return null;

  return (
    <View
      testID={testID}
      aria-hidden
      style={[
        s.badge,
        {
          minWidth: minimumSize,
          minHeight: minimumSize,
          backgroundColor: colors.badgeUnread,
        },
      ]}
    >
      <Text
        style={[s.text, { color: colors.white }]}
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER}
      >
        {count > 99 ? '99+' : String(count)}
      </Text>
    </View>
  );
}
