import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { getSystemAnnouncement } from '@/features/profile/system-announcements';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const s = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.md,
  },
  card: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
});

export default function SystemAnnouncementDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const announcementId = Array.isArray(id) ? id[0] : id;
  const announcement = getSystemAnnouncement(announcementId);
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      card: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      title: { color: colors.text, ...Typography.h2, flex: 1 },
      meta: { color: colors.textSecondary, ...Typography.small },
      body: {
        color: colors.text,
        ...Typography.bodyRegular,
        lineHeight: 24,
      },
      unavailable: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
        textAlign: 'center' as const,
        paddingVertical: Spacing.xl,
      },
    }),
    [colors],
  );

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader
        title={t('systemAnnouncements.detailTitle', {
          defaultValue: '公告详情',
        })}
        fallbackHref="/(tabs)/profile/system-announcements"
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          s.content,
          { paddingBottom: insets.bottom + Spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {announcement ? (
          <View style={[s.card, d.card]}>
            <View style={s.titleRow}>
              <Ionicons name="megaphone-outline" size={24} color={colors.primary} />
              <Text selectable style={d.title}>
                {t(announcement.titleKey)}
              </Text>
            </View>
            <Text selectable style={d.meta}>
              {t(announcement.metaKey)}
            </Text>
            <Text selectable style={d.body}>
              {t(announcement.bodyKey)}
            </Text>
          </View>
        ) : (
          <Text selectable style={d.unavailable}>
            {t('systemAnnouncements.unavailable', {
              defaultValue: '该公告不存在或已下线',
            })}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}
