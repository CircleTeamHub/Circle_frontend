import { SettingsDetailScreen } from '@/features/profile/components/settings-detail';

export default function AboutSettingsScreen() {
  return (
    <SettingsDetailScreen
      titleKey="settingsDetails.about.title"
      sections={[
        {
          rows: [
            {
              id: 'version',
              labelKey: 'settingsDetails.about.version',
              valueKey: 'settingsDetails.about.versionValue',
            },
            {
              id: 'user-agreement',
              labelKey: 'settingsDetails.about.userAgreement',
            },
            {
              id: 'privacy-policy',
              labelKey: 'settingsDetails.about.privacyPolicy',
            },
            {
              id: 'check-updates',
              labelKey: 'settingsDetails.about.checkUpdates',
              valueKey: 'settingsDetails.about.latest',
            },
          ],
        },
      ]}
    />
  );
}
