import { useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { MyCirclesPanel } from '@/features/discover/components/my-circles-panel';
import { Spacing, useTheme } from '@/theme';

const s = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
  },
});

export default function CircleManagementScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();

  const d = useMemo(
    () => ({
      container: {
        backgroundColor: colors.background,
        paddingTop: insets.top,
      },
    }),
    [colors.background, insets.top],
  );

  const handleOpenSettings = useCallback(() => {
    router.push('/(tabs)/discover/notifications');
  }, [router]);

  return (
    <View style={[s.container, d.container]}>
      <NavHeader
        title={t('discover.management')}
        fallbackHref="/(tabs)/discover"
        rightIcon="settings-outline"
        onRightPress={handleOpenSettings}
        rightAccessibilityLabel={t('discover.notifications.title')}
      />
      <ScrollView
        contentContainerStyle={[
          s.content,
          { paddingBottom: insets.bottom + Spacing.xl },
        ]}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        <MyCirclesPanel />
      </ScrollView>
    </View>
  );
}
