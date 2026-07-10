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
import { reportNotificationFailure } from '@/features/notifications/utils/report-failure';
import { logClientDiagnostic } from '@/utils/client-diagnostics';

type NotificationsModule = typeof import('expo-notifications');
type NotificationPermissionResult = Awaited<
  ReturnType<NotificationsModule['getPermissionsAsync']>
>;

type StoredPushRegistration = {
  token: string;
  userId: string;
};

type PushTokenDeleteOptions = { retryOnAuthError?: boolean };

type PushTokenRegistrationOrchestratorDependencies = {
  platform: PushTokenPlatform;
  appVersion: string | null;
  getProjectId: () => string | null;
  getStoredRegistration: () => StoredPushRegistration | null;
  setStoredRegistration: (value: StoredPushRegistration | null) => void;
  loadNotificationsModule: () => Promise<NotificationsModule | null>;
  registerPushToken: typeof registerPushToken;
  deletePushToken: (
    token: string,
    options?: PushTokenDeleteOptions,
  ) => Promise<void>;
  reportFailure: typeof reportNotificationFailure;
  reportDiagnostic: typeof logClientDiagnostic;
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

export function createPushTokenRegistrationOrchestrator(
  dependencies: PushTokenRegistrationOrchestratorDependencies,
) {
  type DesiredRegistration =
    | { kind: 'enabled'; owner: number; userId: string }
    | { kind: 'disabled' }
    | { kind: 'signed-out' };

  const permissionAttemptedUserIds = new Set<string>();
  let generation = 0;
  let logoutGateClosed = false;
  let nextOwner = 0;
  let desiredRegistration: DesiredRegistration = { kind: 'signed-out' };
  const getDesiredRegistration = (): DesiredRegistration => desiredRegistration;

  async function deleteRemotePushToken(
    token: string,
    options: PushTokenDeleteOptions,
  ) {
    try {
      await dependencies.deletePushToken(token, options);
    } catch (error) {
      dependencies.reportFailure('push_token_unregister_failed', error);
    }
  }

  async function unregisterStoredPushToken(
    options: PushTokenDeleteOptions = {},
  ) {
    const stored = dependencies.getStoredRegistration();
    if (!stored) return;

    // Local state is authoritative for teardown. Clear it before touching the
    // network so a failed DELETE cannot revive this registration.
    dependencies.setStoredRegistration(null);
    await deleteRemotePushToken(stored.token, options);
  }

  return {
    unregisterStoredPushToken,
    async logout() {
      logoutGateClosed = true;
      desiredRegistration = { kind: 'signed-out' };
      generation += 1;
      await unregisterStoredPushToken({ retryOnAuthError: false });
    },
    async sync(input: {
      isAuthenticated: boolean;
      userId: string;
      pushEnabled: boolean;
      isCancelled?: () => boolean;
    }) {
      if (!input.isAuthenticated || !input.userId) {
        desiredRegistration = { kind: 'signed-out' };
        logoutGateClosed = false;
        return;
      }
      if (logoutGateClosed || input.isCancelled?.()) return;
      if (!input.pushEnabled) {
        desiredRegistration = { kind: 'disabled' };
        generation += 1;
        await unregisterStoredPushToken();
        return;
      }
      if (dependencies.platform === 'web') return;
      const runGeneration = generation;
      const owner = ++nextOwner;
      desiredRegistration = { kind: 'enabled', owner, userId: input.userId };
      const isCurrentOwner = () =>
        desiredRegistration.kind === 'enabled' &&
        desiredRegistration.owner === owner;
      const isStale = () =>
        generation !== runGeneration ||
        !isCurrentOwner() ||
        Boolean(input.isCancelled?.());

      const notifications = await dependencies.loadNotificationsModule();
      if (!notifications || isStale()) return;

      let permissions = await notifications.getPermissionsAsync();
      if (isStale()) return;
      if (!isNotificationGranted(permissions, notifications)) {
        if (
          permissions.canAskAgain === false ||
          permissionAttemptedUserIds.has(input.userId)
        ) {
          return;
        }
        permissionAttemptedUserIds.add(input.userId);
        permissions = await notifications.requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
          },
        });
        if (
          isStale() ||
          !isNotificationGranted(permissions, notifications)
        ) {
          return;
        }
      }

      const projectId = dependencies.getProjectId();
      if (!projectId) {
        dependencies.reportDiagnostic('push_token_project_id_missing', {
          platform: dependencies.platform,
        });
        return;
      }

      const result = await notifications.getExpoPushTokenAsync({ projectId });
      const token = result.data;
      if (!token || isStale()) return;

      const stored = dependencies.getStoredRegistration();
      if (stored?.token === token && stored.userId === input.userId) return;

      await dependencies.registerPushToken({
        token,
        platform: dependencies.platform,
        provider: 'expo',
        projectId,
        appVersion: dependencies.appVersion,
      });
      if (isStale()) {
        const currentDesired = getDesiredRegistration();
        if (
          currentDesired.kind === 'enabled' &&
          currentDesired.userId === input.userId
        ) {
          return;
        }
        await deleteRemotePushToken(
          token,
          currentDesired.kind === 'disabled'
            ? {}
            : { retryOnAuthError: false },
        );
        return;
      }
      dependencies.setStoredRegistration({ token, userId: input.userId });
    },
  };
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

const pushTokenRegistrationOrchestrator =
  createPushTokenRegistrationOrchestrator({
    platform: Platform.OS as PushTokenPlatform,
    appVersion: Constants.expoConfig?.version ?? null,
    getProjectId,
    getStoredRegistration,
    setStoredRegistration,
    loadNotificationsModule,
    registerPushToken,
    deletePushToken,
    reportFailure: reportNotificationFailure,
    reportDiagnostic: logClientDiagnostic,
  });

export function PushNotificationTokenRegistrar() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const userId = useAuthStore((state) => state.user?.id ?? '');
  const pushEnabled = useAppSettingsStore(
    (state) => state.settings.pushNotifications,
  );
  const [permissionRefreshKey, setPermissionRefreshKey] = useState(0);
  const inFlightKeyRef = useRef<string | null>(null);

  useEffect(
    () =>
      registerLogoutHandler(() => pushTokenRegistrationOrchestrator.logout()),
    [],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setPermissionRefreshKey((value) => value + 1);
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const runKey = `${userId}:${pushEnabled}:${permissionRefreshKey}`;
    if (inFlightKeyRef.current === runKey) return;
    inFlightKeyRef.current = runKey;

    (async () => {
      await pushTokenRegistrationOrchestrator.sync({
        isAuthenticated,
        userId,
        pushEnabled,
        isCancelled: () => cancelled,
      });
    })().catch((error) => {
      reportNotificationFailure('push_token_register_failed', error, {
        platform: Platform.OS,
      });
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
