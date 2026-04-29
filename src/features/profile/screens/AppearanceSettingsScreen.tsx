import { SettingsDetailScreen } from '@/features/profile/components/settings-detail';

export default function AppearanceSettingsScreen() {
  return (
    <SettingsDetailScreen
      titleKey="settingsDetails.appearance.title"
      sections={[
        {
          rows: [
            {
              id: 'theme-mode',
              labelKey: 'settingsDetails.appearance.themeMode',
              valueKey: 'settingsDetails.appearance.followSystem',
            },
            {
              id: 'display-mode',
              labelKey: 'settingsDetails.appearance.displayMode',
              valueKey: 'settingsDetails.appearance.autoRecommended',
            },
            {
              id: 'font-size',
              labelKey: 'settingsDetails.appearance.fontSize',
              valueKey: 'settingsDetails.appearance.standard',
            },
            {
              id: 'global-chat-background',
              labelKey: 'settingsDetails.appearance.globalChatBackground',
              valueKey: 'settingsDetails.appearance.configured',
            },
            {
              id: 'hide-chat-avatar',
              labelKey: 'settingsDetails.appearance.hideChatAvatar',
              subtitleKey: 'settingsDetails.appearance.hideChatAvatarHint',
              type: 'toggle',
              initialValue: false,
            },
            {
              id: 'merge-avatar',
              labelKey: 'settingsDetails.appearance.mergeAvatar',
              subtitleKey: 'settingsDetails.appearance.mergeAvatarHint',
              type: 'toggle',
              initialValue: false,
            },
            {
              id: 'show-group-tags',
              labelKey: 'settingsDetails.appearance.showGroupTags',
              subtitleKey: 'settingsDetails.appearance.showGroupTagsHint',
              type: 'toggle',
              initialValue: true,
            },
            {
              id: 'show-original-group-name',
              labelKey: 'settingsDetails.appearance.showOriginalGroupName',
              subtitleKey: 'settingsDetails.appearance.showOriginalGroupNameHint',
              type: 'toggle',
              initialValue: false,
            },
            {
              id: 'pinned-fold-count',
              labelKey: 'settingsDetails.appearance.pinnedFoldCount',
              subtitleKey: 'settingsDetails.appearance.pinnedFoldCountHint',
              valueKey: 'settingsDetails.appearance.unlimited',
            },
            {
              id: 'battery-optimization',
              labelKey: 'settingsDetails.appearance.batteryOptimization',
              subtitleKey: 'settingsDetails.appearance.batteryOptimizationHint',
              type: 'toggle',
              initialValue: true,
            },
          ],
        },
      ]}
    />
  );
}
