import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import {
  deletePushToken,
  registerPushToken,
  type PushTokenPlatform,
} from '@/services/api/notifications';
import { registerLogoutHandler } from '@/services/auth/session';
import { useAuthStore } from '@/stores/authStore';
import { storage } from '@/storage';
import { useAppSettingsStore } from '@/features/profile/store/use-app-settings-store';

type NotificationsModule = typeof import('expo-notifications');
type NotificationPermissionResult = Awaited<
  ReturnType<NotificationsModule['getPermissionsAsync']>
>;

type StoredPushRegistration = {
  token: string;
  userId: string;
};

const PUSH_REGISTRATION_KEY = 'circle-im-push-registration';
const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

function getProjectId() {
  const constants = Constants as typeof Constants & {
    easConfig?: { projectId?: string };
  };
  const extra = Constants.expoConfig?.extra as
    | { eas?: { projectId?: string }; projectId?: string }
    | undefined;
  return (
    constants.easConfig?.projectId ??
    extra?.eas?.projectId ??
    extra?.projectId ??
    null
  );
}

function getStoredRegistration(): StoredPushRegistration | null {
  const raw = storage.getString(PUSH_REGISTRATION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredPushRegistration>;
    return typeof parsed.token === 'string' &&
      parsed.token.length > 0 &&
      typeof parsed.userId === 'string' &&
      parsed.userId.length > 0
      ? { token: parsed.token, userId: parsed.userId }
      : null;
  } catch {
    return null;
  }
}

function setStoredRegistration(value: StoredPushRegistration | null) {
  if (!value) {
    storage.remove(PUSH_REGISTRATION_KEY);
    return;
  }
  storage.set(PUSH_REGISTRATION_KEY, JSON.stringify(value));
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
    if (isDev) console.warn('[notifications] module unavailable', error);
    return null;
  }
}

async function unregisterStoredPushToken() {
  const stored = getStoredRegistration();
  if (!stored) return;
  try {
    await deletePushToken(stored.token);
  } catch (error) {
    if (isDev) console.warn('[notifications] push token unregister failed', error);
  } finally {
    setStoredRegistration(null);
  }
}

export function PushNotificationTokenRegistrar() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const userId = useAuthStore((state) => state.user?.id ?? '');
  const pushEnabled = useAppSettingsStore(
    (state) => state.settings.pushNotifications,
  );
  const [permissionRefreshKey, setPermissionRefreshKey] = useState(0);
  const inFlightKeyRef = useRef<string | null>(null);

  useEffect(() => registerLogoutHandler(unregisterStoredPushToken), []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setPermissionRefreshKey((value) => value + 1);
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !userId) return;

    let cancelled = false;
    const runKey = `${userId}:${pushEnabled}:${permissionRefreshKey}`;
    if (inFlightKeyRef.current === runKey) return;
    inFlightKeyRef.current = runKey;

    (async () => {
      if (!pushEnabled) {
        await unregisterStoredPushToken();
        return;
      }

      const notifications = await loadNotificationsModule();
      if (!notifications || cancelled) return;

      const permissions = await notifications.getPermissionsAsync();
      if (cancelled || !isNotificationGranted(permissions, notifications)) {
        return;
      }

      const projectId = getProjectId();
      const result = projectId
        ? await notifications.getExpoPushTokenAsync({ projectId })
        : await notifications.getExpoPushTokenAsync();
      const token = result.data;
      if (cancelled || !token) return;

      const stored = getStoredRegistration();
      if (stored?.token === token && stored.userId === userId) return;

      await registerPushToken({
        token,
        platform: Platform.OS as PushTokenPlatform,
        provider: 'expo',
        projectId,
        appVersion: Constants.expoConfig?.version ?? null,
      });
      if (!cancelled) {
        setStoredRegistration({ token, userId });
      }
    })().catch((error) => {
      if (isDev) console.warn('[notifications] push token registration failed', error);
    });

    return () => {
      cancelled = true;
      if (inFlightKeyRef.current === runKey) {
        inFlightKeyRef.current = null;
      }
    };
  }, [isAuthenticated, permissionRefreshKey, pushEnabled, userId]);

  return null;
}
