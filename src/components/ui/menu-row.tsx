import { useMemo } from 'react';
import { View, Text, Pressable, Switch, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Spacing, Typography } from '@/theme';
import { IconCircle } from './icon-circle';

interface MenuRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  iconBgColor?: string;
  label: string;
  subtitle?: string;
  rightText?: string;
  showIndicatorDot?: boolean;
  showArrow?: boolean;
  hasToggle?: boolean;
  toggleValue?: boolean;
  onToggle?: (val: boolean) => void;
  destructive?: boolean;
  onPress?: () => void;
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 52,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  indicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
});

export const MenuRow: React.FC<MenuRowProps> = ({
  icon,
  iconBgColor,
  label,
  subtitle,
  rightText,
  showIndicatorDot,
  showArrow = true,
  hasToggle,
  toggleValue,
  onToggle,
  destructive,
  onPress,
}) => {
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      label: {
        color: colors.text,
        ...Typography.body,
      },
      destructive: {
        color: colors.error,
      },
      subtitle: {
        color: colors.textSecondary,
        ...Typography.small,
        marginTop: 2,
      },
      rightText: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
      indicatorDot: {
        backgroundColor: colors.error,
      },
    }),
    [colors],
  );

  return (
    <Pressable style={s.row} onPress={onPress}>
      <View style={s.left}>
        {iconBgColor ? (
          <IconCircle name={icon} size={32} bgColor={iconBgColor} />
        ) : (
          <Ionicons name={icon} size={20} color={colors.text} />
        )}
        <View>
          <Text style={[d.label, destructive && d.destructive]}>
            {label}
          </Text>
          {subtitle ? (
            <Text style={d.subtitle}>{subtitle}</Text>
          ) : null}
        </View>
      </View>
      <View style={s.right}>
        {showIndicatorDot ? (
          <View style={[s.indicatorDot, d.indicatorDot]} />
        ) : null}
        {rightText ? <Text style={d.rightText}>{rightText}</Text> : null}
        {hasToggle ? (
          <Switch
            value={toggleValue}
            onValueChange={onToggle}
            trackColor={{ false: colors.surfaceBorder, true: colors.primary }}
            thumbColor={colors.white}
          />
        ) : showArrow ? (
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        ) : null}
      </View>
    </Pressable>
  );
};
