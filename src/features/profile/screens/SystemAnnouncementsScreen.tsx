import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const ANNOUNCEMENTS = [
  {
    id: 'latestAppInfo',
    titleKey: 'systemAnnouncements.latestAppInfo.title',
    metaKey: 'systemAnnouncements.latestAppInfo.meta',
    bodyKey: 'systemAnnouncements.latestAppInfo.body',
  },
  {
    id: 'updates',
    titleKey: 'systemAnnouncements.updates.title',
    metaKey: 'systemAnnouncements.updates.meta',
    bodyKey: 'systemAnnouncements.updates.body',
  },
  {
    id: 'patches',
    titleKey: 'systemAnnouncements.patches.title',
    metaKey: 'systemAnnouncements.patches.meta',
    bodyKey: 'systemAnnouncements.patches.body',
  },
] as const;

const s = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
});

export default function SystemAnnouncementsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      content: {
        paddingHorizontal: Spacing.lg,
        paddingBottom: insets.bottom + Spacing.xl,
        gap: Spacing.md,
      },
      intro: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
        lineHeight: 21,
      },
      card: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      title: {
        color: colors.text,
        ...Typography.h3,
      },
      meta: {
        color: colors.textSecondary,
        ...Typography.small,
      },
      body: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
        lineHeight: 21,
      },
    }),
    [colors, insets.bottom],
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('systemAnnouncements.title')} />
      <ScrollView
        contentContainerStyle={d.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={d.intro}>{t('systemAnnouncements.subtitle')}</Text>

        {ANNOUNCEMENTS.map((item) => (
          <View key={item.id} style={[s.card, d.card]}>
            <View style={s.cardHeader}>
              <Ionicons name="megaphone-outline" size={20} color={colors.primary} />
              <Text style={d.title}>{t(item.titleKey)}</Text>
            </View>
            <Text style={d.meta}>{t(item.metaKey)}</Text>
            <Text style={d.body}>{t(item.bodyKey)}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
