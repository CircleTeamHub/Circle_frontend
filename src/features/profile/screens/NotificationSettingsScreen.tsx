import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { OptionPickerSheet } from '@/components/ui/option-picker-sheet';
import { SettingsDetailScreen } from '@/features/profile/components/settings-detail';
import { useNotificationFeedbackStore } from '@/features/notifications/store/use-notification-feedback-store';
import { useAppSettingsStore } from '@/features/profile/store/use-app-settings-store';
import { useCircleNotificationTiers } from '@/features/discover/hooks/use-circle-notification-tiers';
import type { NotificationRingtone } from '@/features/notifications/store/use-notification-feedback-store';
import { fetchGroupOfflinePushEnabled, updateGroupOfflinePushEnabled } from '@/services/api/notifications';
import { useAuthStore } from '@/stores/authStore';
import { reportHandledFailure } from '@/observability/report-failure';
import { useTheme } from '@/theme';
import { openSystemSettings } from '@/utils/open-system-settings';

// A remounted screen can start a newer save while the previous screen's response is pending.
let latestGroupPreferenceMutation = 0;

export default function NotificationSettingsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const sessionEpoch = useAuthStore(s => s.sessionEpoch);
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
  const messageRingtone = useNotificationFeedbackStore(s => s.messageRingtone);
  const circleRingtone = useNotificationFeedbackStore(s => s.circleRingtone);
  const [ringtoneSheet, setRingtoneSheet] = useState<'message' | 'circle' | null>(null);
  const ringtoneOptions = useMemo(() => (['default', 'soft', 'bell'] as const).map(value => ({ value, label: t(`settingsDetails.notifications.ringtones.${value}`) })), [t]);
  const [groupLoaded, setGroupLoaded] = useState(false);
  const [groupSaving, setGroupSaving] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const groupRequest = useRef(0);
  const groupInFlight = useRef(false);

  useEffect(() => {
    const request = ++groupRequest.current;
    const mutationAtLoad = latestGroupPreferenceMutation;
    setGroupLoaded(false);
    setGroupSaving(false);
    groupInFlight.current = false;
    setGroupError(null);
    void fetchGroupOfflinePushEnabled().then(value => {
      if (request !== groupRequest.current || useAuthStore.getState().sessionEpoch !== sessionEpoch) return;
      if (mutationAtLoad === latestGroupPreferenceMutation && useAppSettingsStore.getState().settings.groupGlobalPush) setSetting('groupOfflinePush', value);
      setGroupLoaded(true);
    }).catch(error => {
      if (request !== groupRequest.current || useAuthStore.getState().sessionEpoch !== sessionEpoch) return;
      setGroupError(t('settingsDetails.notifications.syncFailed'));
      reportHandledFailure('notificationSettings', 'groupPreferenceLoad', error);
    });
    return () => { groupRequest.current += 1; };
  }, [reloadKey, sessionEpoch, setSetting, t]);

  async function saveGroupPreference(key: 'groupGlobalPush' | 'groupOfflinePush', value: boolean) {
    if (!groupLoaded || groupInFlight.current || useAuthStore.getState().sessionEpoch !== sessionEpoch) return;
    const request = ++groupRequest.current;
    const mutation = ++latestGroupPreferenceMutation;
    const before = useAppSettingsStore.getState().settings;
    groupInFlight.current = true;
    setGroupSaving(true);
    setGroupError(null);
    setSetting(key, value);
    const next = useAppSettingsStore.getState().settings;
    try {
      const saved = await updateGroupOfflinePushEnabled(next.groupGlobalPush && next.groupOfflinePush);
      if (mutation !== latestGroupPreferenceMutation || useAuthStore.getState().sessionEpoch !== sessionEpoch) return;
      if (saved !== (next.groupGlobalPush && next.groupOfflinePush)) throw new Error('Group push preference was not saved');
      setSetting('groupGlobalPush', next.groupGlobalPush);
      setSetting('groupOfflinePush', next.groupOfflinePush);
    } catch (error) {
      if (mutation !== latestGroupPreferenceMutation || useAuthStore.getState().sessionEpoch !== sessionEpoch) return;
      setSetting('groupGlobalPush', before.groupGlobalPush);
      setSetting('groupOfflinePush', before.groupOfflinePush);
      if (request === groupRequest.current) setGroupError(t('settingsDetails.notifications.syncFailed'));
      reportHandledFailure('notificationSettings', 'groupPreferenceSave', error);
    } finally {
      if (mutation === latestGroupPreferenceMutation && useAuthStore.getState().sessionEpoch === sessionEpoch) latestGroupPreferenceMutation++;
      if (request === groupRequest.current) {
        groupInFlight.current = false;
        setGroupSaving(false);
      }
    }
  }

  return (
    <>
    <SettingsDetailScreen
      testIDPrefix="notifications"
      titleKey="settingsDetails.notifications.title"
      header={groupError ? <View>
        <Text style={{ color: colors.error }}>{groupError}</Text>
        {!groupLoaded ? <Pressable onPress={() => setReloadKey(v => v + 1)} accessibilityRole="button"><Text style={{ color: colors.primary }}>{t('common.retry')}</Text></Pressable> : null}
      </View> : undefined}
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
              subtitleKey: 'settingsDetails.notifications.inAppHint',
              type: 'toggle',
              value: hapticsEnabled,
              onValueChange: setHapticsEnabled,
            },
            {
              id: 'sound',
              labelKey: 'settingsDetails.notifications.sound',
              subtitleKey: 'settingsDetails.notifications.inAppHint',
              type: 'toggle',
              value: soundEnabled,
              onValueChange: setSoundEnabled,
            },
            {
              id: 'message-ringtone',
              labelKey: 'settingsDetails.notifications.messageRingtone',
              subtitleKey: 'settingsDetails.notifications.inAppHint',
              valueText: t(`settingsDetails.notifications.ringtones.${messageRingtone}`),
              onPress: () => setRingtoneSheet('message'),
            },
            {
              id: 'quick-chat-sheet',
              labelKey: 'settingsDetails.notifications.quickChatSheet',
              subtitleKey: 'settingsDetails.notifications.quickChatSheetHint',
              type: 'toggle',
              value: settings.quickChatSheet,
              onValueChange: (value) => setSetting('quickChatSheet', value),
            },
            {
              id: 'auto-reply',
              labelKey: 'settingsDetails.notifications.autoReply',
              subtitleKey: 'settingsDetails.notifications.autoReplyHint',
              onPress: () => router.push('/(tabs)/profile/settings-auto-reply'),
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
              onValueChange: (value) => void saveGroupPreference('groupGlobalPush', value),
              disabled: !groupLoaded || groupSaving,
            },
            {
              id: 'group-online',
              labelKey: 'settingsDetails.notifications.groupOnline',
              subtitleKey: 'settingsDetails.notifications.groupOnlineHint',
              type: 'toggle',
              value: settings.groupGlobalPush && settings.groupOnlinePush,
              onValueChange: (value) => setSetting('groupOnlinePush', value),
              disabled: !settings.groupGlobalPush,
            },
            {
              id: 'group-offline',
              labelKey: 'settingsDetails.notifications.groupOffline',
              subtitleKey: 'settingsDetails.notifications.groupOfflineHint',
              type: 'toggle',
              value: settings.groupGlobalPush && settings.groupOfflinePush,
              onValueChange: (value) => void saveGroupPreference('groupOfflinePush', value),
              disabled: !settings.groupGlobalPush || !groupLoaded || groupSaving,
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
              subtitleKey: 'settingsDetails.notifications.inAppHint',
              valueText: t(`settingsDetails.notifications.ringtones.${circleRingtone}`),
              onPress: () => setRingtoneSheet('circle'),
            },
          ],
        },
        { rows: [{ id: 'system-notifications', labelKey: 'settingsDetails.notifications.systemSettings', subtitleKey: 'settingsDetails.notifications.systemSettingsHint', onPress: () => void openSystemSettings() }] },
      ]}
    />
    <OptionPickerSheet<NotificationRingtone>
      visible={ringtoneSheet !== null}
      title={t(ringtoneSheet === 'circle' ? 'settingsDetails.notifications.circleRingtone' : 'settingsDetails.notifications.messageRingtone')}
      options={ringtoneOptions}
      selectedValue={ringtoneSheet === 'circle' ? circleRingtone : messageRingtone}
      onSelect={value => {
        const store = useNotificationFeedbackStore.getState();
        if (ringtoneSheet === 'circle') store.setCircleRingtone(value);
        else store.setMessageRingtone(value);
      }}
      onClose={() => setRingtoneSheet(null)}
    />
    </>
  );
}
