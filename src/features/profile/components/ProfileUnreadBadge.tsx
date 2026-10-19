import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';

const styles = StyleSheet.create({
  badge: {
    position: 'absolute', top: 8, right: 8,
    minWidth: 22, height: 22, paddingHorizontal: 5,
    alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 2,
  },
  text: { fontSize: 11, lineHeight: 14, fontWeight: '700', includeFontPadding: false },
});

export function ProfileUnreadBadge({ count }: { count: number }) {
  const { colors } = useTheme();
  if (count <= 0) return null;
  return (
    <View aria-hidden style={[styles.badge, { backgroundColor: colors.error, borderColor: colors.surface }]}>
      <Text style={[styles.text, { color: colors.white }]} numberOfLines={1} maxFontSizeMultiplier={1}>
        {count > 99 ? '99+' : String(count)}
      </Text>
    </View>
  );
}
