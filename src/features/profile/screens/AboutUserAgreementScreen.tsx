import { AboutArticleScreen } from '@/features/profile/screens/about-article-screen';

export default function AboutUserAgreementScreen() {
  return (
    <AboutArticleScreen
      titleKey="settingsDetails.about.agreementTitle"
      sections={[
        {
          titleKey: 'settingsDetails.about.agreementTitle',
          bodyKey: 'settingsDetails.about.agreementBody',
        },
      ]}
    />
  );
}
