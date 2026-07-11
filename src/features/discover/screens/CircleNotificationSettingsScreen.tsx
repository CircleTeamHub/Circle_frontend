import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { Spacing, Typography, useTheme } from '@/theme';
import { useCircleNotificationStore } from '@/features/discover/store/use-circle-notification-store';

interface NotificationItemProps {
  title: string;
  onHint: string;
  offHint: string;
  value: boolean;
  disabled?: boolean;
  onToggle: (value: boolean) => void;
}

const s = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  pageTitle: {
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    gap: Spacing.md,
  },
  textBlock: {
    flex: 1,
    gap: Spacing.xs,
  },
  itemTitle: {
    ...Typography.h3,
  },
  hintLine: {
    ...Typography.caption,
  },
  divider: {
    height: 1,
  },
  guideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.lg,
  },
  guideText: {
    flex: 1,
    gap: Spacing.xs,
  },
  guideTitle: {
    ...Typography.h3,
  },
  guideHint: {
    ...Typography.caption,
  },
});

const NotificationItem: React.FC<NotificationItemProps> = ({
  title,
  onHint,
  offHint,
  value,
  disabled,
  onToggle,
}) => {
  const { colors } = useTheme();

  return (
    <View style={[s.itemRow, disabled ? { opacity: 0.4 } : null]}>
      <View style={s.textBlock}>
        <Text style={[s.itemTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[s.hintLine, { color: colors.textSecondary }]}>
          {onHint}
        </Text>
        <Text style={[s.hintLine, { color: colors.textSecondary }]}>
          {offHint}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        disabled={disabled}
        trackColor={{ false: colors.surfaceBorder, true: colors.primary }}
        thumbColor={colors.white}
      />
    </View>
  );
};

export default function CircleNotificationSettingsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const router = useRouter();

  const globalEnabled = useCircleNotificationStore((st) => st.globalEnabled);
  const bannerEnabled = useCircleNotificationStore((st) => st.bannerEnabled);
  const offlineEnabled = useCircleNotificationStore((st) => st.offlineEnabled);
  const setGlobalEnabled = useCircleNotificationStore(
    (st) => st.setGlobalEnabled,
  );
  const setBannerEnabled = useCircleNotificationStore(
    (st) => st.setBannerEnabled,
  );
  const setOfflineEnabled = useCircleNotificationStore(
    (st) => st.setOfflineEnabled,
  );

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      pageTitle: {
        color: colors.text,
        ...Typography.h1,
      },
      divider: { backgroundColor: colors.divider },
    }),
    [colors],
  );

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('discover.notifications.title')} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[s.pageTitle, d.pageTitle]}>
          {t('discover.notifications.title')}
        </Text>

        {/* 圈子玩法说明入口：讲清卡片颜色含义 + 活动怎么玩。 */}
        <Pressable
          style={s.guideRow}
          onPress={() => router.push('/(tabs)/discover/guide')}
          accessibilityRole="button"
          accessibilityLabel={t('discover.guide.title')}
        >
          <Ionicons name="book-outline" size={22} color={colors.primary} />
          <View style={s.guideText}>
            <Text style={[s.guideTitle, { color: colors.text }]}>
              {t('discover.guide.title')}
            </Text>
            <Text style={[s.guideHint, { color: colors.textSecondary }]}>
              {t('discover.guide.entryHint')}
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.textSecondary}
          />
        </Pressable>

        <View style={[s.divider, d.divider]} />

        <NotificationItem
          title={t('discover.notifications.global')}
          onHint={t('discover.notifications.globalOnHint')}
          offHint={t('discover.notifications.globalOffHint')}
          value={globalEnabled}
          onToggle={setGlobalEnabled}
        />

        <View style={[s.divider, d.divider]} />

        <NotificationItem
          title={t('discover.notifications.banner')}
          onHint={t('discover.notifications.bannerOnHint')}
          offHint={t('discover.notifications.bannerOffHint')}
          value={globalEnabled && bannerEnabled}
          disabled={!globalEnabled}
          onToggle={setBannerEnabled}
        />

        <View style={[s.divider, d.divider]} />

        <NotificationItem
          title={t('discover.notifications.offline')}
          onHint={t('discover.notifications.offlineOnHint')}
          offHint={t('discover.notifications.offlineOffHint')}
          value={globalEnabled && offlineEnabled}
          disabled={!globalEnabled}
          onToggle={setOfflineEnabled}
        />
      </ScrollView>
    </View>
  );
}
