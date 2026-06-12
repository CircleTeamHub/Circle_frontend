import { AboutArticleScreen } from '@/features/profile/screens/about-article-screen';

const CAPABILITY_KEYS = [
  'settingsDetails.about.capabilityChat',
  'settingsDetails.about.capabilityPrivacy',
  'settingsDetails.about.capabilityCircle',
] as const;

export default function AboutProductScreen() {
  return (
    <AboutArticleScreen
      titleKey="settingsDetails.about.brandName"
      sections={[
        {
          titleKey: 'settingsDetails.about.brandName',
          bodyKey: 'settingsDetails.about.tagline',
        },
        {
          titleKey: 'settingsDetails.about.productIntro',
          bodyKey: 'settingsDetails.about.description',
        },
        {
          titleKey: 'settingsDetails.about.capabilitiesTitle',
          bulletKeys: CAPABILITY_KEYS,
        },
      ]}
    />
  );
}
