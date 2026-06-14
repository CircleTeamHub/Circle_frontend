import { AboutArticleScreen } from '@/features/profile/screens/about-article-screen';

export default function AboutPrivacyPolicyScreen() {
  return (
    <AboutArticleScreen
      titleKey="settingsDetails.about.policyTitle"
      sections={[
        {
          titleKey: 'settingsDetails.about.policyTitle',
          bodyKey: 'settingsDetails.about.policyBody',
        },
        {
          titleKey: 'settingsDetails.about.privacyTitle',
          bodyKey: 'settingsDetails.about.privacyBody',
        },
      ]}
    />
  );
}
