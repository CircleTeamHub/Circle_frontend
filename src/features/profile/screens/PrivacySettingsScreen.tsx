import { SettingsDetailScreen } from '@/features/profile/components/settings-detail';

export default function PrivacySettingsScreen() {
  return (
    <SettingsDetailScreen
      titleKey="settingsDetails.privacy.title"
      sections={[
        {
          rows: [
            {
              id: 'self-destruct',
              labelKey: 'settingsDetails.privacy.selfDestruct',
              valueKey: 'settingsDetails.privacy.twoDays',
            },
            {
              id: 'self-destruct-tip',
              labelKey: 'settingsDetails.privacy.selfDestructTip',
              subtitleKey: 'settingsDetails.privacy.selfDestructTipHint',
              type: 'toggle',
              initialValue: true,
            },
            {
              id: 'blacklist',
              labelKey: 'settingsDetails.privacy.blacklist',
            },
            {
              id: 'online-time',
              labelKey: 'settingsDetails.privacy.onlineTime',
              type: 'toggle',
              initialValue: true,
            },
            {
              id: 'moments-visibility',
              labelKey: 'settingsDetails.privacy.momentsVisibility',
              valueKey: 'settingsDetails.privacy.all',
            },
            {
              id: 'stranger-message',
              labelKey: 'settingsDetails.privacy.strangerMessage',
              type: 'toggle',
              initialValue: true,
            },
            {
              id: 'single-typing',
              labelKey: 'settingsDetails.privacy.singleTyping',
              type: 'toggle',
              initialValue: true,
            },
            {
              id: 'group-typing',
              labelKey: 'settingsDetails.privacy.groupTyping',
              type: 'toggle',
              initialValue: true,
            },
          ],
        },
        {
          rows: [
            {
              id: 'show-phone',
              labelKey: 'settingsDetails.privacy.showPhone',
              type: 'toggle',
              initialValue: false,
            },
            {
              id: 'show-wechat',
              labelKey: 'settingsDetails.privacy.showWechat',
              type: 'toggle',
              initialValue: true,
            },
            {
              id: 'show-qq',
              labelKey: 'settingsDetails.privacy.showQQ',
              type: 'toggle',
              initialValue: true,
            },
          ],
        },
        {
          rows: [
            {
              id: 'personalized-recommendation',
              labelKey: 'settingsDetails.privacy.personalizedRecommendation',
              type: 'toggle',
              initialValue: false,
            },
            {
              id: 'youth-mode',
              labelKey: 'settingsDetails.privacy.youthMode',
              type: 'toggle',
              initialValue: false,
            },
          ],
        },
        {
          rows: [
            {
              id: 'add-me-methods',
              labelKey: 'settingsDetails.privacy.addMeMethods',
            },
            {
              id: 'call-permission',
              labelKey: 'settingsDetails.privacy.callPermission',
            },
            {
              id: 'group-invite-permission',
              labelKey: 'settingsDetails.privacy.groupInvitePermission',
            },
          ],
        },
      ]}
    />
  );
}
