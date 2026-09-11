import { SettingsDetailScreen } from '@/features/profile/components/settings-detail';
import { useNotificationFeedbackStore } from '@/features/notifications/store/use-notification-feedback-store';
import { useAppSettingsStore } from '@/features/profile/store/use-app-settings-store';
import { useCircleNotificationTiers } from '@/features/discover/hooks/use-circle-notification-tiers';

export default function NotificationSettingsScreen() {
  const settings = useAppSettingsStore((s) => s.settings);
  const setSetting = useAppSettingsStore((s) => s.setSetting);
  // 三档的读写走与圈子弹层同一个 hook。此前这三行直接 set 本地 store，
  // 「离线提醒」关了不通知服务端 —— 推送照来，下次打开弹层还会被 GET 翻回去。
  const circle = useCircleNotificationTiers();
  const soundEnabled = useNotificationFeedbackStore((s) => s.soundEnabled);
  const hapticsEnabled = useNotificationFeedbackStore((s) => s.hapticsEnabled);
  const setSoundEnabled = useNotificationFeedbackStore((s) => s.setSoundEnabled);
  const setHapticsEnabled = useNotificationFeedbackStore(
    (s) => s.setHapticsEnabled,
  );

  return (
    <SettingsDetailScreen
      testIDPrefix="notifications"
      titleKey="settingsDetails.notifications.title"
      sections={[
        {
          titleKey: 'settingsDetails.notifications.baseSection',
          rows: [
            {
              id: 'push',
              labelKey: 'settingsDetails.notifications.push',
              type: 'toggle',
              value: settings.pushNotifications,
              onValueChange: (value) => setSetting('pushNotifications', value),
            },
            {
              id: 'vibration',
              labelKey: 'settingsDetails.notifications.vibration',
              type: 'toggle',
              value: hapticsEnabled,
              onValueChange: setHapticsEnabled,
            },
            {
              id: 'sound',
              labelKey: 'settingsDetails.notifications.sound',
              type: 'toggle',
              value: soundEnabled,
              onValueChange: setSoundEnabled,
            },
            {
              id: 'message-ringtone',
              labelKey: 'settingsDetails.notifications.messageRingtone',
              valueKey: 'settingsDetails.notifications.messageDefault',
            },
          ],
        },
        {
          titleKey: 'settingsDetails.notifications.friendSection',
          rows: [
            {
              id: 'friend-request',
              labelKey: 'settingsDetails.notifications.friendRequest',
              subtitleKey: 'settingsDetails.notifications.friendRequestHint',
              type: 'toggle',
              value: settings.friendRequestNotifications,
              onValueChange: (value) =>
                setSetting('friendRequestNotifications', value),
            },
            {
              id: 'group-request',
              labelKey: 'settingsDetails.notifications.groupRequest',
              subtitleKey: 'settingsDetails.notifications.groupRequestHint',
              type: 'toggle',
              value: settings.groupRequestNotifications,
              onValueChange: (value) =>
                setSetting('groupRequestNotifications', value),
            },
          ],
        },
        {
          titleKey: 'settingsDetails.notifications.groupSection',
          rows: [
            {
              id: 'group-global',
              labelKey: 'settingsDetails.notifications.groupGlobal',
              subtitleKey: 'settingsDetails.notifications.groupGlobalHint',
              type: 'toggle',
              value: settings.groupGlobalPush,
              onValueChange: (value) => setSetting('groupGlobalPush', value),
            },
            {
              id: 'group-online',
              labelKey: 'settingsDetails.notifications.groupOnline',
              subtitleKey: 'settingsDetails.notifications.groupOnlineHint',
              type: 'toggle',
              value: settings.groupOnlinePush,
              onValueChange: (value) => setSetting('groupOnlinePush', value),
              disabled: !settings.groupGlobalPush,
            },
            {
              id: 'group-offline',
              labelKey: 'settingsDetails.notifications.groupOffline',
              subtitleKey: 'settingsDetails.notifications.groupOfflineHint',
              type: 'toggle',
              value: settings.groupOfflinePush,
              onValueChange: (value) => setSetting('groupOfflinePush', value),
              disabled: !settings.groupGlobalPush,
            },
          ],
        },
        {
          titleKey: 'settingsDetails.notifications.circleSection',
          rows: [
            {
              id: 'circle-global',
              labelKey: 'settingsDetails.notifications.circleGlobal',
              subtitleKey: 'settingsDetails.notifications.circleGlobalHint',
              type: 'toggle',
              value: circle.globalEnabled,
              onValueChange: circle.setGlobalEnabled,
            },
            {
              id: 'circle-sound',
              labelKey: 'settingsDetails.notifications.circleSound',
              subtitleKey: 'settingsDetails.notifications.circleSoundHint',
              type: 'toggle',
              value: circle.soundValue,
              onValueChange: circle.setSoundEnabled,
              disabled: !circle.globalEnabled,
            },
            {
              id: 'circle-offline',
              labelKey: 'settingsDetails.notifications.circleOffline',
              subtitleKey: 'settingsDetails.notifications.circleOfflineHint',
              type: 'toggle',
              value: circle.offlineValue,
              onValueChange: circle.setOfflineEnabled,
              disabled: !circle.globalEnabled,
            },
            {
              id: 'circle-ringtone',
              labelKey: 'settingsDetails.notifications.circleRingtone',
              valueKey: 'settingsDetails.notifications.circleDefault',
            },
          ],
        },
      ]}
    />
  );
}
