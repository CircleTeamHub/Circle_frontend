import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import {
  registerPushToken,
  revokePushToken,
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
  revocationSecret: string;
  status: 'pending' | 'registered';
};

type PushTokenRevocation = Pick<
  StoredPushRegistration,
  'token' | 'revocationSecret'
>;

type PushTokenRegistrationOrchestratorDependencies = {
  platform: PushTokenPlatform;
  appVersion: string | null;
  getProjectId: () => string | null;
  getStoredRegistration: () => StoredPushRegistration | null;
  setStoredRegistration: (value: StoredPushRegistration | null) => void;
  getPendingRevocations: () => PushTokenRevocation[];
  setPendingRevocations: (value: PushTokenRevocation[]) => void;
  generateRevocationSecret: () => string;
  loadNotificationsModule: () => Promise<NotificationsModule | null>;
  registerPushToken: typeof registerPushToken;
  revokePushToken: typeof revokePushToken;
  reportFailure: typeof reportNotificationFailure;
  reportDiagnostic: typeof logClientDiagnostic;
};

const PUSH_REGISTRATION_KEY = 'circle-im-push-registration';
const PUSH_REVOCATIONS_KEY = 'circle-im-push-revocations';
const MAX_PENDING_REVOCATIONS = 50;
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
      parsed.userId.length > 0 &&
      typeof parsed.revocationSecret === 'string' &&
      parsed.revocationSecret.length >= 32 &&
      (parsed.status === 'pending' || parsed.status === 'registered')
      ? {
          token: parsed.token,
          userId: parsed.userId,
          revocationSecret: parsed.revocationSecret,
          status: parsed.status,
        }
      : null;
  } catch {
    return null;
  }
}

function getPendingRevocations(): PushTokenRevocation[] {
  const raw = storage.getString(PUSH_REVOCATIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is PushTokenRevocation =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as PushTokenRevocation).token === 'string' &&
        typeof (item as PushTokenRevocation).revocationSecret === 'string' &&
        (item as PushTokenRevocation).revocationSecret.length >= 32,
    );
  } catch {
    return [];
  }
}

function setPendingRevocations(value: PushTokenRevocation[]) {
  if (value.length === 0) {
    storage.remove(PUSH_REVOCATIONS_KEY);
    return;
  }
  storage.set(PUSH_REVOCATIONS_KEY, JSON.stringify(value));
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
  let logoutGateClosed = false;
  let nextOwner = 0;
  let desiredRegistration: DesiredRegistration = { kind: 'signed-out' };
  let mutationTail: Promise<void> = Promise.resolve();

  function enqueueRemoteMutation(operation: () => Promise<void>) {
    const result = mutationTail.then(operation, operation);
    mutationTail = result.catch(() => {});
    return result;
  }

  function revocationKey(value: PushTokenRevocation) {
    return `${value.token}\u0000${value.revocationSecret}`;
  }

  function addPendingRevocation(value: PushTokenRevocation) {
    const key = revocationKey(value);
    const current = dependencies.getPendingRevocations();
    if (current.some((item) => revocationKey(item) === key)) return;
    const capped =
      current.length >= MAX_PENDING_REVOCATIONS
        ? current.slice(-(MAX_PENDING_REVOCATIONS - 1))
        : current;
    if (capped.length !== current.length) {
      dependencies.reportDiagnostic('push_token_revocation_queue_capped', {
        cap: MAX_PENDING_REVOCATIONS,
      });
    }
    dependencies.setPendingRevocations([...capped, value]);
  }

  function removePendingRevocation(value: PushTokenRevocation) {
    const key = revocationKey(value);
    dependencies.setPendingRevocations(
      dependencies
        .getPendingRevocations()
        .filter((item) => revocationKey(item) !== key),
    );
  }

  function flushPendingRevocations() {
    return enqueueRemoteMutation(async () => {
      for (const revocation of dependencies.getPendingRevocations()) {
        if (
          !dependencies
            .getPendingRevocations()
            .some((item) => revocationKey(item) === revocationKey(revocation))
        ) {
          continue;
        }
        try {
          await dependencies.revokePushToken(
            revocation.token,
            revocation.revocationSecret,
          );
          removePendingRevocation(revocation);
        } catch (error) {
          dependencies.reportFailure('push_token_revoke_failed', error);
        }
      }
    });
  }

  function retireStoredRegistration() {
    const stored = dependencies.getStoredRegistration();
    if (!stored) return;
    addPendingRevocation(stored);
    dependencies.setStoredRegistration(null);
    void flushPendingRevocations();
  }

  return {
    flushPendingRevocations,
    logout() {
      logoutGateClosed = true;
      desiredRegistration = { kind: 'signed-out' };
      retireStoredRegistration();
      void flushPendingRevocations();
    },
    async sync(input: {
      isAuthenticated: boolean;
      userId: string;
      pushEnabled: boolean;
      isCancelled?: () => boolean;
    }) {
      void flushPendingRevocations();
      if (!input.isAuthenticated || !input.userId) {
        desiredRegistration = { kind: 'signed-out' };
        logoutGateClosed = false;
        retireStoredRegistration();
        return;
      }
      if (logoutGateClosed || input.isCancelled?.()) return;
      if (!input.pushEnabled) {
        desiredRegistration = { kind: 'disabled' };
        retireStoredRegistration();
        return;
      }
      if (dependencies.platform === 'web') return;
      const owner = ++nextOwner;
      desiredRegistration = { kind: 'enabled', owner, userId: input.userId };
      if (dependencies.getStoredRegistration()?.userId !== input.userId) {
        retireStoredRegistration();
      }
      const isCurrentOwner = () =>
        desiredRegistration.kind === 'enabled' &&
        desiredRegistration.owner === owner;
      const isStale = () =>
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
        try {
          permissions = await notifications.requestPermissionsAsync({
            ios: {
              allowAlert: true,
              allowBadge: true,
              allowSound: true,
            },
          });
        } catch (error) {
          permissionAttemptedUserIds.delete(input.userId);
          throw error;
        }
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

      let candidate = dependencies.getStoredRegistration();
      if (
        candidate &&
        dependencies
          .getPendingRevocations()
          .some((item) => revocationKey(item) === revocationKey(candidate!))
      ) {
        dependencies.setStoredRegistration(null);
        candidate = null;
      }
      if (candidate?.token !== token || candidate.userId !== input.userId) {
        retireStoredRegistration();
        candidate = {
          token,
          userId: input.userId,
          revocationSecret: dependencies.generateRevocationSecret(),
          status: 'pending',
        };
        dependencies.setStoredRegistration(candidate);
      }
      if (candidate.status === 'registered') return;

      const registrationCandidate = candidate;
      await enqueueRemoteMutation(async () => {
        if (!isCurrentOwner() || input.isCancelled?.()) return;

        const activeBefore = dependencies.getStoredRegistration();
        if (
          activeBefore?.token !== registrationCandidate.token ||
          activeBefore.userId !== registrationCandidate.userId ||
          activeBefore.revocationSecret !== registrationCandidate.revocationSecret
        ) {
          return;
        }
        if (activeBefore.status === 'registered') return;

        await dependencies.registerPushToken({
          token,
          platform: dependencies.platform,
          provider: 'expo',
          revocationSecret: registrationCandidate.revocationSecret,
          projectId,
          appVersion: dependencies.appVersion,
        });

        const currentDesired = desiredRegistration;
        const activeAfter = dependencies.getStoredRegistration();
        if (
          currentDesired.kind === 'enabled' &&
          currentDesired.userId === input.userId &&
          activeAfter?.token === registrationCandidate.token &&
          activeAfter.userId === registrationCandidate.userId &&
          activeAfter.revocationSecret === registrationCandidate.revocationSecret
        ) {
          dependencies.setStoredRegistration({
            ...registrationCandidate,
            status: 'registered',
          });
        }
      });
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
    getPendingRevocations,
    setPendingRevocations,
    generateRevocationSecret: () => Crypto.randomUUID(),
    loadNotificationsModule,
    registerPushToken,
    revokePushToken,
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
