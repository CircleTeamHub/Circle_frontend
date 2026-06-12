import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';
import { AboutArticleScreen } from '@/features/profile/screens/about-article-screen';

export default function AboutVersionScreen() {
  const { t } = useTranslation();
  const appVersion = Constants.expoConfig?.version ?? '1.0.0';
  const versionLabel = t('settingsDetails.about.versionValue', {
    version: appVersion,
  });

  return (
    <AboutArticleScreen
      titleKey="settingsDetails.about.updateTitle"
      sections={[
        {
          titleKey: 'settingsDetails.about.version',
          valueText: versionLabel,
        },
        {
          titleKey: 'settingsDetails.about.updateTitle',
          bodyKey: 'settingsDetails.about.updateBody',
        },
      ]}
    />
  );
}
