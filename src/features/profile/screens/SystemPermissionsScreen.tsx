import { Linking, Pressable, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SettingsDetailScreen } from '@/features/profile/components/settings-detail';
import { Spacing, Typography, useTheme } from '@/theme';

const s = StyleSheet.create({
  footer: {
    alignItems: 'center',
    gap: Spacing.sm,
  },
});

export default function SystemPermissionsScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <SettingsDetailScreen
      titleKey="settingsDetails.permissions.title"
      sections={[
        {
          rows: [
            {
              id: 'location',
              labelKey: 'settingsDetails.permissions.location',
              statusKey: 'settingsDetails.permissions.authorized',
              icon: 'location-outline',
            },
            {
              id: 'storage',
              labelKey: 'settingsDetails.permissions.storage',
              statusKey: 'settingsDetails.permissions.unauthorized',
              icon: 'folder-outline',
              iconMuted: true,
            },
            {
              id: 'microphone',
              labelKey: 'settingsDetails.permissions.microphone',
              statusKey: 'settingsDetails.permissions.authorized',
              icon: 'mic-outline',
            },
            {
              id: 'camera',
              labelKey: 'settingsDetails.permissions.camera',
              statusKey: 'settingsDetails.permissions.authorized',
              icon: 'camera-outline',
            },
            {
              id: 'photo-library',
              labelKey: 'settingsDetails.permissions.photoLibrary',
              statusKey: 'settingsDetails.permissions.authorized',
              icon: 'images-outline',
            },
            {
              id: 'notifications',
              labelKey: 'settingsDetails.permissions.notifications',
              statusKey: 'settingsDetails.permissions.authorized',
              icon: 'notifications-outline',
            },
            {
              id: 'bluetooth',
              labelKey: 'settingsDetails.permissions.bluetooth',
              statusKey: 'settingsDetails.permissions.unauthorized',
              icon: 'bluetooth-outline',
              iconMuted: true,
            },
          ],
        },
      ]}
      footer={
        <Pressable style={s.footer} onPress={() => Linking.openSettings()}>
          <Text style={{ color: colors.textSecondary, ...Typography.body }}>
            {t('settingsDetails.permissions.onlyVisibleAuthorized')}
          </Text>
          <Text style={{ color: colors.success, ...Typography.h3 }}>
            {t('settingsDetails.permissions.openSystemSettings')}
          </Text>
        </Pressable>
      }
    />
  );
}
