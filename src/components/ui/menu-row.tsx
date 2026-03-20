import React, { useMemo } from 'react';
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
  showArrow?: boolean;
  hasToggle?: boolean;
  toggleValue?: boolean;
  onToggle?: (val: boolean) => void;
  destructive?: boolean;
  onPress?: () => void;
}

export const MenuRow: React.FC<MenuRowProps> = ({
  icon,
  iconBgColor,
  label,
  subtitle,
  rightText,
  showArrow = true,
  hasToggle,
  toggleValue,
  onToggle,
  destructive,
  onPress,
}) => {
  const { colors } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
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
      }),
    [colors],
  );

  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.left}>
        {iconBgColor ? (
          <IconCircle name={icon} size={32} bgColor={iconBgColor} />
        ) : (
          <Ionicons name={icon} size={20} color={colors.text} />
        )}
        <View>
          <Text style={[styles.label, destructive && styles.destructive]}>
            {label}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle}>{subtitle}</Text>
          ) : null}
        </View>
      </View>
      <View style={styles.right}>
        {rightText ? <Text style={styles.rightText}>{rightText}</Text> : null}
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
