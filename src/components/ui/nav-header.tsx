import { useCallback, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { type Href, useNavigation, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme, Spacing, Typography } from '@/theme';

type NavHeaderAction = {
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
};

interface NavHeaderProps {
  title: string;
  rightIcon?: keyof typeof Ionicons.glyphMap;
  onRightPress?: () => void;
  rightActions?: NavHeaderAction[];
  onBackPress?: () => void;
  fallbackHref?: Href;
  // 当 rightIcon 是非自描述图标时（比如 settings-outline / help-circle-outline），
  // 调用方应该传入 accessibilityLabel 让屏幕阅读器知道做什么。
  rightAccessibilityLabel?: string;
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 48,
    paddingHorizontal: Spacing.lg,
  },
  spacer: {
    width: 24,
  },
  rightActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
});

export const NavHeader: React.FC<NavHeaderProps> = ({
  title,
  rightIcon,
  onRightPress,
  rightActions,
  onBackPress,
  fallbackHref,
  rightAccessibilityLabel,
}) => {
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { t } = useTranslation();

  const handleBackPress = useCallback(() => {
    if (onBackPress) {
      onBackPress();
    } else if (navigation.canGoBack()) {
      router.back();
    } else if (fallbackHref) {
      router.replace(fallbackHref);
    }
  }, [fallbackHref, navigation, onBackPress, router]);

  const d = useMemo(
    () => ({
      title: {
        color: colors.text,
        ...Typography.h3,
      },
    }),
    [colors],
  );
  const actions = rightActions ?? (
    rightIcon
      ? [
          {
            icon: rightIcon,
            onPress: onRightPress,
            accessibilityLabel: rightAccessibilityLabel ?? rightIcon,
          },
        ]
      : []
  );

  return (
    <View style={s.container}>
      <Pressable
        onPress={handleBackPress}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('common.back', { defaultValue: '返回' })}
      >
        <Ionicons name="chevron-back" size={24} color={colors.text} />
      </Pressable>
      <Text style={d.title} accessibilityRole="header">
        {title}
      </Text>
      {actions.length > 0 ? (
        <View style={s.rightActionRow}>
          {actions.map((action) => (
            <Pressable
              key={action.icon}
              onPress={action.onPress}
              disabled={action.disabled}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={action.accessibilityLabel ?? action.icon}
            >
              <Ionicons
                name={action.icon}
                size={22}
                color={
                  action.disabled ? colors.textSecondary : colors.textSecondary
                }
              />
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={s.spacer} />
      )}
    </View>
  );
};
