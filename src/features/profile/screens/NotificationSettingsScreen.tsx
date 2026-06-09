import { SettingsDetailScreen } from '@/features/profile/components/settings-detail';
import { useNotificationFeedbackStore } from '@/features/notifications/store/use-notification-feedback-store';

export default function NotificationSettingsScreen() {
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
              initialValue: true,
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
              initialValue: true,
            },
            {
              id: 'group-request',
              labelKey: 'settingsDetails.notifications.groupRequest',
              subtitleKey: 'settingsDetails.notifications.groupRequestHint',
              type: 'toggle',
              initialValue: true,
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
              initialValue: true,
            },
            {
              id: 'group-online',
              labelKey: 'settingsDetails.notifications.groupOnline',
              subtitleKey: 'settingsDetails.notifications.groupOnlineHint',
              type: 'toggle',
              initialValue: true,
            },
            {
              id: 'group-offline',
              labelKey: 'settingsDetails.notifications.groupOffline',
              subtitleKey: 'settingsDetails.notifications.groupOfflineHint',
              type: 'toggle',
              initialValue: false,
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
              initialValue: true,
            },
            {
              id: 'circle-sound',
              labelKey: 'settingsDetails.notifications.circleSound',
              subtitleKey: 'settingsDetails.notifications.circleSoundHint',
              type: 'toggle',
              initialValue: false,
            },
            {
              id: 'circle-ringtone',
              labelKey: 'settingsDetails.notifications.circleRingtone',
              valueKey: 'settingsDetails.notifications.circleDefault',
            },
            {
              id: 'offline-reminder',
              labelKey: 'settingsDetails.notifications.offlineReminder',
              subtitleKey: 'settingsDetails.notifications.offlineReminderHint',
              type: 'toggle',
              initialValue: false,
            },
          ],
        },
      ]}
    />
  );
}
