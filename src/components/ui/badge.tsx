import { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/theme';

interface BadgeProps {
  count: number;
}

const s = StyleSheet.create({
  badge: {
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
  },
});

export const Badge: React.FC<BadgeProps> = ({ count }) => {
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      badge: {
        backgroundColor: colors.primary,
      },
      text: {
        color: colors.white,
      },
    }),
    [colors],
  );

  if (count <= 0) return null;

  // iMessage / WeChat 风格：超过 99 用 "99+" 防止 badge 撑破布局。
  const display = count > 99 ? '99+' : String(count);

  return (
    <View style={[s.badge, d.badge]}>
      <Text style={[s.text, d.text]}>{display}</Text>
    </View>
  );
};
