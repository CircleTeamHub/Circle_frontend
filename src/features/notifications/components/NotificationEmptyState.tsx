import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Spacing, useTheme } from '@/theme';

interface Props {
  title: string;
  subtitle: string;
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: Spacing.xl, gap: 8 },
});

export const NotificationEmptyState = memo(function NotificationEmptyState(p: Props) {
  const { colors } = useTheme();
  return (
    <View style={s.wrap}>
      <Ionicons name="notifications-outline" size={34} color={colors.textSecondary} />
      <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{p.title}</Text>
      <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: 'center' }}>{p.subtitle}</Text>
    </View>
  );
});
