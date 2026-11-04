import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { SettingsDetailScreen } from '@/features/profile/components/settings-detail';
import type { SettingsDetailRow } from '@/features/profile/components/settings-detail';

export default function AboutSettingsScreen() {
  const router = useRouter();
  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  const productRows: SettingsDetailRow[] = [
    {
      id: 'product-intro',
      labelKey: 'settingsDetails.about.productIntro',
      subtitleKey: 'settingsDetails.about.tagline',
      onPress: () => router.push('/(tabs)/profile/settings-about-product' as never),
    },
    {
      id: 'version',
      labelKey: 'settingsDetails.about.version',
      valueText: appVersion,
      onPress: () => router.push('/(tabs)/profile/settings-about-version' as never),
    },
    {
      // 不在这里写死「已是最新」：没查过就不报状态，点进去再真正检查。
      id: 'check-updates',
      labelKey: 'settingsDetails.about.checkUpdates',
      onPress: () => router.push('/(tabs)/profile/settings-about-version' as never),
    },
  ];

  const legalRows: SettingsDetailRow[] = [
    {
      id: 'user-agreement',
      labelKey: 'settingsDetails.about.userAgreement',
      subtitleKey: 'settingsDetails.about.agreementSummary',
      onPress: () =>
        router.push('/(tabs)/profile/settings-about-user-agreement' as never),
    },
    {
      id: 'privacy-policy',
      labelKey: 'settingsDetails.about.privacyPolicy',
      subtitleKey: 'settingsDetails.about.policySummary',
      onPress: () =>
        router.push('/(tabs)/profile/settings-about-privacy-policy' as never),
    },
    {
      id: 'third-party-licenses',
      labelKey: 'settingsDetails.about.thirdPartyLicenses',
      onPress: () => router.push('/(tabs)/profile/settings-about-licenses' as never),
    },
  ];

  return (
    <SettingsDetailScreen
      titleKey="settingsDetails.about.title"
      sections={[{ rows: productRows }, { rows: legalRows }]}
    />
  );
}
