import { SettingsDetailScreen } from '@/features/profile/components/settings-detail';
import { useNotificationFeedbackStore } from '@/features/notifications/store/use-notification-feedback-store';
import { useAppSettingsStore } from '@/features/profile/store/use-app-settings-store';
import { useCircleNotificationStore } from '@/features/discover/store/use-circle-notification-store';

export default function NotificationSettingsScreen() {
  const settings = useAppSettingsStore((s) => s.settings);
  const setSetting = useAppSettingsStore((s) => s.setSetting);
  const circleInAppEnabled = useCircleNotificationStore((s) => s.inAppEnabled);
  const circleBannerEnabled = useCircleNotificationStore((s) => s.bannerEnabled);
  const setCircleInAppEnabled = useCircleNotificationStore(
    (s) => s.setInAppEnabled,
  );
  const setCircleBannerEnabled = useCircleNotificationStore(
    (s) => s.setBannerEnabled,
  );
  const soundEnabled = useNotificationFeedbackStore((s) => s.soundEnabled);
  const hapticsEnabled = useNotificationFeedbackStore((s) => s.hapticsEnabled);
  const setSoundEnabled = useNotificationFeedbackStore((s) => s.setSoundEnabled);
  const setHapticsEnabled = useNotificationFeedbackStore(
    (s) => s.setHapticsEnabled,
  );

  return (
    <SettingsDetailScreen
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
              value: circleInAppEnabled,
              onValueChange: setCircleInAppEnabled,
            },
            {
              id: 'circle-banner',
              labelKey: 'settingsDetails.notifications.circleBanner',
              subtitleKey: 'settingsDetails.notifications.circleBannerHint',
              type: 'toggle',
              value: circleBannerEnabled,
              onValueChange: setCircleBannerEnabled,
              disabled: !circleInAppEnabled,
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
