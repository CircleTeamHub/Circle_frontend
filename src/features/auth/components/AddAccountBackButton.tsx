import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAccountSwitcherStore } from '@/stores/accountSwitcherStore';
import { Spacing, useTheme } from '@/theme';

const s = StyleSheet.create({
  button: {
    position: 'absolute',
    left: Spacing.md,
    padding: Spacing.xs,
    zIndex: 1,
  },
});

/**
 * 「切换账号 → 添加账号」时登录页压在已登录的会话上。登录页本是未登录时的根页面、
 * 没有返回键,这里补一个看得见的,改主意的人不必知道要横滑。
 */
export function AddAccountBackButton() {
  const addingAccount = useAccountSwitcherStore((state) => state.addingAccount);
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();

  if (!addingAccount || !router.canGoBack()) return null;

  return (
    <Pressable
      style={[s.button, { top: insets.top + Spacing.sm }]}
      onPress={() => router.back()}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={t('common.back', { defaultValue: '返回' })}
    >
      <Ionicons name="chevron-back" size={24} color={colors.text} />
    </Pressable>
  );
}
