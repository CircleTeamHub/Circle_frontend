import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface ProfileActionRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  label: string;
  value?: string;
  onPress?: () => void;
}

// 行内边距(16) + 图标块(28) + 图标与文字间距(12)，分隔线据此左缩进对齐文字
export const ICON_BADGE_SIZE = 28;
export const ROW_PADDING_H = Spacing.md;
export const ROW_GAP = Spacing.md - 4;

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ROW_GAP,
    paddingVertical: 10,
    paddingHorizontal: ROW_PADDING_H,
  },
  pressed: {
    opacity: 0.55,
  },
  iconBadge: {
    width: ICON_BADGE_SIZE,
    height: ICON_BADGE_SIZE,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    flexShrink: 1,
  },
  value: {
    flexShrink: 1,
    textAlign: 'right',
  },
});

export const ProfileActionRow = ({
  icon,
  iconColor,
  label,
  value,
  onPress,
}: ProfileActionRowProps) => {
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      iconBadge: { backgroundColor: iconColor },
      label: { color: colors.text, ...Typography.body },
      value: { color: colors.textSecondary, ...Typography.caption },
    }),
    [colors, iconColor],
  );

  return (
    <Pressable
      style={({ pressed }) => [s.row, pressed && s.pressed]}
      onPress={onPress}
    >
      <View style={[s.iconBadge, d.iconBadge]}>
        <Ionicons name={icon} size={17} color={colors.white} />
      </View>
      <View style={s.body}>
        <Text style={d.label}>{label}</Text>
        <View style={s.right}>
          {value ? (
            <Text style={[s.value, d.value]} numberOfLines={1}>
              {value}
            </Text>
          ) : null}
          <Ionicons
            name="chevron-forward"
            size={16}
            color={colors.textSecondary}
          />
        </View>
      </View>
    </Pressable>
  );
};
