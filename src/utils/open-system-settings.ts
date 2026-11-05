import { Alert, Linking, Platform } from 'react-native';
import i18n from '@/i18n';
import { reportHandledFailure } from '@/observability/report-failure';

export async function openSystemSettings(): Promise<void> {
  const title = i18n.t('settingsDetails.permissions.title');
  if (Platform.OS === 'web') {
    Alert.alert(title, i18n.t('settingsDetails.permissions.browserSettingsHint'));
    return;
  }
  await Linking.openSettings().catch(error => {
    reportHandledFailure('permissions', 'openSystemSettings', error);
    Alert.alert(title, i18n.t('settingsDetails.permissions.openSettingsFailed'));
  });
}
