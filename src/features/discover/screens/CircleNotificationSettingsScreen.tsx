import { useMemo } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
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

  const globalEnabled = useCircleNotificationStore((st) => st.globalEnabled);
  const soundEnabled = useCircleNotificationStore((st) => st.soundEnabled);
  const offlineEnabled = useCircleNotificationStore((st) => st.offlineEnabled);
  const setGlobalEnabled = useCircleNotificationStore(
    (st) => st.setGlobalEnabled,
  );
  const setSoundEnabled = useCircleNotificationStore(
    (st) => st.setSoundEnabled,
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

        <NotificationItem
          title={t('discover.notifications.global')}
          onHint={t('discover.notifications.globalOnHint')}
          offHint={t('discover.notifications.globalOffHint')}
          value={globalEnabled}
          onToggle={setGlobalEnabled}
        />

        <View style={[s.divider, d.divider]} />

        <NotificationItem
          title={t('discover.notifications.sound')}
          onHint={t('discover.notifications.soundOnHint')}
          offHint={t('discover.notifications.soundOffHint')}
          value={globalEnabled && soundEnabled}
          disabled={!globalEnabled}
          onToggle={setSoundEnabled}
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
