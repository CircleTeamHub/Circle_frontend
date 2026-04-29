import { SettingsDetailScreen } from '@/features/profile/components/settings-detail';

export default function AccountSecuritySettingsScreen() {
  return (
    <SettingsDetailScreen
      titleKey="settingsDetails.accountSecurity.title"
      sections={[
        {
          titleKey: 'settingsDetails.accountSecurity.loginSecuritySection',
          rows: [
            {
              id: 'single-device-login',
              labelKey: 'settingsDetails.accountSecurity.singleDeviceLogin',
              type: 'toggle',
              initialValue: false,
            },
            {
              id: 'login-device-management',
              labelKey: 'settingsDetails.accountSecurity.loginDeviceManagement',
              destructive: true,
            },
          ],
        },
        {
          titleKey: 'settingsDetails.accountSecurity.appLockSection',
          rows: [
            {
              id: 'device-lock',
              labelKey: 'settingsDetails.accountSecurity.deviceLock',
              type: 'toggle',
              initialValue: false,
            },
          ],
        },
        {
          titleKey: 'settingsDetails.accountSecurity.thirdPartySection',
          rows: [
            {
              id: 'wechat-binding',
              labelKey: 'settingsDetails.accountSecurity.wechatBinding',
            },
          ],
        },
        {
          titleKey: 'settingsDetails.accountSecurity.accountActionsSection',
          rows: [
            {
              id: 'switch-account',
              labelKey: 'settingsDetails.accountSecurity.switchAccount',
            },
            {
              id: 'logout',
              labelKey: 'settingsDetails.accountSecurity.logout',
              destructive: true,
            },
            {
              id: 'cancel-account',
              labelKey: 'settingsDetails.accountSecurity.cancelAccount',
              destructive: true,
            },
          ],
        },
      ]}
    />
  );
}
