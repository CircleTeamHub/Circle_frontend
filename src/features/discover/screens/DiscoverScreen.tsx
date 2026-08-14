import { useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Divider } from '@/components/ui/divider';
import { MenuRow } from '@/components/ui/menu-row';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const s = StyleSheet.create({
  header: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    gap: Spacing.lg,
  },
  section: {
    gap: Spacing.xs,
  },
  sectionCard: {
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
});

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const momentsUnread = useTabBadgeStore((state) => state.discoverUnread);
  const plazaUnread = useTabBadgeStore((state) => state.signupUnread);

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      header: {
        borderBottomColor: colors.divider,
      },
      title: {
        color: colors.text,
        ...Typography.title,
      },
      sectionTitle: {
        color: colors.textSecondary,
        ...Typography.caption,
        fontWeight: '600' as const,
      },
      sectionCard: {
        backgroundColor: colors.surface,
      },
    }),
    [colors],
  );

  const handleOpenMoments = useCallback(() => {
    router.push('/(tabs)/discover/moments');
  }, [router]);

  const handleOpenPlaza = useCallback(() => {
    router.push('/(tabs)/discover/plaza');
  }, [router]);

  const handleOpenManagement = useCallback(() => {
    router.push('/(tabs)/discover/management');
  }, [router]);

  return (
    <View style={d.container}>
      <View
        style={[
          s.header,
          d.header,
          { paddingTop: insets.top + Spacing.md - 4 },
        ]}
      >
        <Text style={d.title} accessibilityRole="header">
          {t('discover.title')}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          s.content,
          { paddingBottom: insets.bottom + Spacing.xl },
        ]}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        <View style={s.section}>
          <Text style={d.sectionTitle}>{t('discover.moments')}</Text>
          <View style={[s.sectionCard, d.sectionCard]}>
            <MenuRow
              icon="people-outline"
              iconBgColor={colors.orange}
              label={t('discover.moments')}
              showIndicatorDot={momentsUnread > 0}
              onPress={handleOpenMoments}
            />
          </View>
        </View>

        <View style={s.section}>
          <Text style={d.sectionTitle}>{t('contacts.circles')}</Text>
          <View style={[s.sectionCard, d.sectionCard]}>
            <MenuRow
              icon="planet-outline"
              iconBgColor={colors.primary}
              label={t('discover.plaza')}
              showIndicatorDot={plazaUnread > 0}
              onPress={handleOpenPlaza}
            />
            <Divider />
            <MenuRow
              icon="settings-outline"
              iconBgColor={colors.blue}
              label={t('discover.management')}
              onPress={handleOpenManagement}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
