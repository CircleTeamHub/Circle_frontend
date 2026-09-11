import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ThemedSwitch } from '@/components/ui/themed-switch';
import { Spacing, Typography, useTheme } from '@/theme';
import { useCircleNotificationTiers } from '@/features/discover/hooks/use-circle-notification-tiers';

/**
 * 圈子通知三档开关的弹层/整页承载。行为全在 useCircleNotificationTiers 里 ——
 * 个人设置页那三行用的是同一个 hook，两处不可能再各自实现一遍。
 */

interface NotificationItemProps {
  title: string;
  onHint: string;
  offHint: string;
  value: boolean;
  disabled?: boolean;
  onToggle: (value: boolean) => void;
}

const s = StyleSheet.create({
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

function NotificationItem({
  title,
  onHint,
  offHint,
  value,
  disabled,
  onToggle,
}: NotificationItemProps) {
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
      <ThemedSwitch value={value} onValueChange={onToggle} disabled={disabled} />
    </View>
  );
}

export function CircleNotificationToggles() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const tiers = useCircleNotificationTiers();

  return (
    <View>
      <NotificationItem
        title={t('discover.notifications.global')}
        onHint={t('discover.notifications.globalOnHint')}
        offHint={t('discover.notifications.globalOffHint')}
        value={tiers.globalEnabled}
        onToggle={tiers.setGlobalEnabled}
      />

      <View style={[s.divider, { backgroundColor: colors.divider }]} />

      <NotificationItem
        title={t('discover.notifications.sound')}
        onHint={t('discover.notifications.soundOnHint')}
        offHint={t('discover.notifications.soundOffHint')}
        value={tiers.soundValue}
        disabled={!tiers.globalEnabled}
        onToggle={tiers.setSoundEnabled}
      />

      <View style={[s.divider, { backgroundColor: colors.divider }]} />

      <NotificationItem
        title={t('discover.notifications.offline')}
        onHint={t('discover.notifications.offlineOnHint')}
        offHint={t('discover.notifications.offlineOffHint')}
        value={tiers.offlineValue}
        disabled={!tiers.globalEnabled}
        onToggle={tiers.setOfflineEnabled}
      />
    </View>
  );
}
