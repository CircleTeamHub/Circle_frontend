import { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemedSwitch } from '@/components/ui/themed-switch';
import { useTheme, Spacing, Typography } from '@/theme';
import { IconCircle } from './icon-circle';
import { UnreadCountBadge } from './unread-count-badge';
import { useTranslation } from 'react-i18next';

interface MenuRowProps {
  testID?: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconBgColor?: string;
  label: string;
  subtitle?: string;
  rightText?: string;
  /** Numeric unread count shown in the trailing badge. Values over 99 render as 99+. */
  badgeCount?: number;
  /**
   * @deprecated Use badgeCount. Kept for callers that still provide a boolean
   * indicator; it now renders as a numeric 1 so unread state stays consistent.
   */
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
    // 占据剩余空间并允许收缩，长标签（西语/日语）才能省略而不是把右侧挤掉。
    flex: 1,
  },
  labelCol: {
    flexShrink: 1,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    // 右侧（箭头/开关/值）保持内容宽度，不被左侧长文本压缩。
    flexShrink: 0,
    marginLeft: Spacing.sm,
  },
});

export const MenuRow: React.FC<MenuRowProps> = ({
  testID,
  icon,
  iconBgColor,
  label,
  subtitle,
  rightText,
  badgeCount,
  showIndicatorDot,
  showArrow = true,
  hasToggle,
  toggleValue,
  onToggle,
  destructive,
  onPress,
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const unreadCount = badgeCount ?? (showIndicatorDot ? 1 : 0);

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
    }),
    [colors],
  );

  // 屏幕阅读器 hint：把 rightText（如 "v1.2.3"）拼进去让用户听得到状态。
  const a11yHint = rightText ? rightText : undefined;

  return (
    <Pressable
      testID={testID}
      style={s.row}
      onPress={onPress}
      accessibilityRole={hasToggle ? 'switch' : 'button'}
      accessibilityLabel={
        unreadCount > 0
          ? `${label}, ${t('common.unreadCount', { count: unreadCount })}`
          : label
      }
      accessibilityHint={a11yHint}
      accessibilityState={hasToggle ? { checked: !!toggleValue } : undefined}
    >
      <View style={s.left}>
        {iconBgColor ? (
          <IconCircle name={icon} size={32} bgColor={iconBgColor} />
        ) : (
          <Ionicons name={icon} size={20} color={colors.text} />
        )}
        <View style={s.labelCol}>
          <Text
            style={[d.label, destructive && d.destructive]}
            numberOfLines={1}
          >
            {label}
          </Text>
          {subtitle ? (
            <Text style={d.subtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={s.right}>
        <UnreadCountBadge count={unreadCount} />
        {rightText ? <Text style={d.rightText}>{rightText}</Text> : null}
        {hasToggle ? (
          <ThemedSwitch
            value={toggleValue}
            onValueChange={onToggle}
            // a11y label/role 在父 Pressable 上已声明；Switch 自身屏蔽 a11y 避免双读。
            // aria-hidden：跨平台别名（原生等价原来的两个 prop，web 不泄进 DOM）。
            aria-hidden
          />
        ) : showArrow ? (
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        ) : null}
      </View>
    </Pressable>
  );
};
