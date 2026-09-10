import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ThemedSwitch } from '@/components/ui/themed-switch';
import { topNotice } from '@/components/app/top-notice-store';
import { Spacing, Typography, useTheme } from '@/theme';
import {
  circleOfflinePushAllowed,
  useCircleNotificationStore,
} from '@/features/discover/store/use-circle-notification-store';
import {
  fetchCircleOfflinePushEnabled,
  updateCircleOfflinePushEnabled,
} from '@/services/api/notifications';

/**
 * 圈子通知的三档开关。整页设置和圈子动态头部的弹层共用这一份，两处只是承载容器不同。
 *
 * 「全局接收圈子通知」是总闸：关掉后横幅、声音、红点、离线推送全停，下面两档同步置灰。
 * 前三样都是本机行为，读 store 即可；离线推送由服务端执行，所以总闸和离线档的每次
 * 改动都要把生效值推给后端（见 syncOfflinePush），否则关了照样收推送。
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

  const globalEnabled = useCircleNotificationStore((st) => st.globalEnabled);
  const soundEnabled = useCircleNotificationStore((st) => st.soundEnabled);
  const offlineEnabled = useCircleNotificationStore((st) => st.offlineEnabled);
  const setGlobalEnabled = useCircleNotificationStore(
    (st) => st.setGlobalEnabled,
  );
  const setSoundEnabled = useCircleNotificationStore((st) => st.setSoundEnabled);
  const setOfflineEnabled = useCircleNotificationStore(
    (st) => st.setOfflineEnabled,
  );

  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // 打开设置时以服务端为准校一次：离线推送的真值在后端，本地只是镜像，
  // 换设备或异地改过之后本地可能已经不对。失败就沿用本地值，不打断用户。
  useEffect(() => {
    let cancelled = false;
    void fetchCircleOfflinePushEnabled()
      .then((enabled) => {
        if (cancelled || !mountedRef.current) return;
        const state = useCircleNotificationStore.getState();
        // 总闸关着时服务端一定是 false，那是总闸的结果，不该反写掉用户的离线档选择。
        if (state.globalEnabled) state.setOfflineEnabled(enabled);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // 把「生效的离线推送值」推给后端。失败要回滚本地开关——留着一个说关了其实没关
  // 的开关，比报错更糟。
  const syncOfflinePush = useCallback(
    (apply: () => void, revert: () => void) => {
      apply();
      const next = circleOfflinePushAllowed(
        useCircleNotificationStore.getState(),
      );
      void updateCircleOfflinePushEnabled(next).catch(() => {
        if (!mountedRef.current) return;
        revert();
        topNotice.error(t('discover.notifications.syncFailed'));
      });
    },
    [t],
  );

  const handleGlobalToggle = useCallback(
    (value: boolean) =>
      syncOfflinePush(
        () => setGlobalEnabled(value),
        () => setGlobalEnabled(!value),
      ),
    [setGlobalEnabled, syncOfflinePush],
  );

  const handleOfflineToggle = useCallback(
    (value: boolean) =>
      syncOfflinePush(
        () => setOfflineEnabled(value),
        () => setOfflineEnabled(!value),
      ),
    [setOfflineEnabled, syncOfflinePush],
  );

  return (
    <View>
      <NotificationItem
        title={t('discover.notifications.global')}
        onHint={t('discover.notifications.globalOnHint')}
        offHint={t('discover.notifications.globalOffHint')}
        value={globalEnabled}
        onToggle={handleGlobalToggle}
      />

      <View style={[s.divider, { backgroundColor: colors.divider }]} />

      <NotificationItem
        title={t('discover.notifications.sound')}
        onHint={t('discover.notifications.soundOnHint')}
        offHint={t('discover.notifications.soundOffHint')}
        value={globalEnabled && soundEnabled}
        disabled={!globalEnabled}
        onToggle={setSoundEnabled}
      />

      <View style={[s.divider, { backgroundColor: colors.divider }]} />

      <NotificationItem
        title={t('discover.notifications.offline')}
        onHint={t('discover.notifications.offlineOnHint')}
        offHint={t('discover.notifications.offlineOffHint')}
        value={globalEnabled && offlineEnabled}
        disabled={!globalEnabled}
        onToggle={handleOfflineToggle}
      />
    </View>
  );
}
