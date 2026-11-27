import { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/theme';

interface BadgeProps {
  count: number;
  /** 底色；不传用主题紫。贴在彩色底上（探索磁贴）时传提醒红，免得和底色糊成一片。 */
  color?: string;
  testID?: string;
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

export const Badge: React.FC<BadgeProps> = ({ count, color, testID }) => {
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      badge: {
        backgroundColor: color ?? colors.primary,
      },
      text: {
        color: colors.white,
      },
    }),
    [color, colors],
  );

  if (count <= 0) return null;

  // iMessage / WeChat 风格：超过 99 用 "99+" 防止 badge 撑破布局。
  const display = count > 99 ? '99+' : String(count);

  return (
    <View testID={testID} style={[s.badge, d.badge]}>
      <Text style={[s.text, d.text]}>{display}</Text>
    </View>
  );
};
