import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';
import { Camera as ExpoCamera } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import { SettingsDetailScreen } from '@/features/profile/components/settings-detail';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { reportHandledFailure } from '@/observability/report-failure';

type PermissionId =
  | 'location'
  | 'microphone'
  | 'camera'
  | 'photo-library'
  | 'notifications';

type PermissionState = Record<PermissionId, boolean>;

type PermissionResult = {
  granted?: boolean;
  canAskAgain?: boolean;
};

type NotificationsModule = typeof import('expo-notifications');
type NotificationPermissionResult = Awaited<
  ReturnType<NotificationsModule['getPermissionsAsync']>
>;

const PERMISSION_IDS: readonly PermissionId[] = [
  'location',
  'microphone',
  'camera',
  'photo-library',
  'notifications',
];

const INITIAL_PERMISSIONS = Object.fromEntries(
  PERMISSION_IDS.map((id) => [id, false]),
) as PermissionState;

const s = StyleSheet.create({
  footer: {
    alignItems: 'center',
    gap: Spacing.sm,
  },
  settingsButton: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
  },
});

function isGranted(result: PermissionResult | null | undefined) {
  return Boolean(result?.granted);
}

function isNotificationGranted(
  result: NotificationPermissionResult,
  notifications: NotificationsModule,
) {
  return Boolean(
    result.granted ||
      result.ios?.status === notifications.IosAuthorizationStatus.PROVISIONAL,
  );
}

async function loadNotificationsModule() {
  try {
    return await import('expo-notifications');
  } catch (error) {
    reportHandledFailure('permissions', 'notificationsModule', error);
    return null;
  }
}

async function getPermission(id: PermissionId) {
  try {
    switch (id) {
      case 'location':
        return isGranted(await Location.getForegroundPermissionsAsync());
      case 'microphone':
        return isGranted(await getRecordingPermissionsAsync());
      case 'camera':
        return isGranted(await ExpoCamera.getCameraPermissionsAsync());
      case 'photo-library':
        return isGranted(await ImagePicker.getMediaLibraryPermissionsAsync());
      case 'notifications': {
        const notifications = await loadNotificationsModule();
        if (!notifications) return false;
        return isNotificationGranted(
          await notifications.getPermissionsAsync(),
          notifications,
        );
      }
      default:
        return false;
    }
  } catch {
    return false;
  }
}

async function requestPermission(id: PermissionId) {
  try {
    let result: PermissionResult | boolean;
    switch (id) {
      case 'location':
        result = await Location.requestForegroundPermissionsAsync();
        break;
      case 'microphone':
        result = await requestRecordingPermissionsAsync();
        break;
      case 'camera':
        result = await ExpoCamera.requestCameraPermissionsAsync();
        break;
      case 'photo-library':
        result = await ImagePicker.requestMediaLibraryPermissionsAsync();
        break;
      case 'notifications': {
        const notifications = await loadNotificationsModule();
        if (!notifications) {
          await Linking.openSettings();
          return false;
        }
        result = await notifications.requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
          },
        });
        break;
      }
      default:
        result = false;
    }

    if (typeof result === 'boolean') {
      if (!result) await Linking.openSettings();
      return result;
    }

    if (!result.granted && result.canAskAgain === false) {
      await Linking.openSettings();
    }
    return Boolean(result.granted);
  } catch {
    await Linking.openSettings();
    return false;
  }
}

export default function SystemPermissionsScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [permissions, setPermissions] =
    useState<PermissionState>(INITIAL_PERMISSIONS);

  const refreshPermissions = useCallback(async () => {
    const entries = await Promise.all(
      PERMISSION_IDS.map(async (id) => [id, await getPermission(id)] as const),
    );
    setPermissions(Object.fromEntries(entries) as PermissionState);
  }, []);

  useEffect(() => {
    void refreshPermissions();
  }, [refreshPermissions]);

  useFocusEffect(
    useCallback(() => {
      void refreshPermissions();
    }, [refreshPermissions]),
  );

  const rows = useMemo(
    () =>
      PERMISSION_IDS.map((id) => {
        const granted = permissions[id];
        return {
          id,
          labelKey: permissionLabelKey(id),
          statusKey: granted
            ? 'settingsDetails.permissions.authorized'
            : 'settingsDetails.permissions.unauthorized',
          icon: permissionIcon(id),
          iconColor: colors.primary,
          iconBackgroundColor: colors.primaryLight,
          statusColor: colors.primary,
          onPress: async () => {
            await requestPermission(id);
            await refreshPermissions();
          },
        };
      }),
    [colors.primary, colors.primaryLight, permissions, refreshPermissions],
  );

  return (
    <SettingsDetailScreen
      titleKey="settingsDetails.permissions.title"
      sections={[{ rows }]}
      footer={
        <View style={s.footer}>
          <Text style={{ color: colors.primary, ...Typography.body }}>
            {t('settingsDetails.permissions.onlyVisibleAuthorized')}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={[s.settingsButton, { backgroundColor: colors.primary }]}
            onPress={() => Linking.openSettings()}
          >
            <Text style={{ color: colors.white, ...Typography.h3 }}>
              {t('settingsDetails.permissions.openSystemSettings')}
            </Text>
          </Pressable>
        </View>
      }
    />
  );
}

function permissionLabelKey(id: PermissionId) {
  const keys: Record<PermissionId, string> = {
    location: 'settingsDetails.permissions.location',
    microphone: 'settingsDetails.permissions.microphone',
    camera: 'settingsDetails.permissions.camera',
    'photo-library': 'settingsDetails.permissions.photoLibrary',
    notifications: 'settingsDetails.permissions.notifications',
  };
  return keys[id];
}

function permissionIcon(id: PermissionId) {
  const icons = {
    location: 'location-outline',
    microphone: 'mic-outline',
    camera: 'camera-outline',
    'photo-library': 'images-outline',
    notifications: 'notifications-outline',
  } as const;
  return icons[id];
}
