import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { registerLogoutHandler } from '@/services/auth/session';
import { useAuthStore } from '@/stores/authStore';
import { useAppSettingsStore } from '@/features/profile/store/use-app-settings-store';
import { reportNotificationFailure } from '@/features/notifications/utils/report-failure';
import { pushTokenRegistrationOrchestrator } from '@/features/notifications/services/push-token-registration';
import { subscribeJPushConnection } from '@/features/notifications/services/jpush';
import { getVoipPushTokenRegistrationOrchestrator } from '@/features/call/push/voip-token-registration';
import { subscribeVoipTokenChanges } from '@/features/call/push/call-push-events';

export function PushNotificationTokenRegistrar() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const userId = useAuthStore((state) => state.user?.id ?? '');
  const pushEnabled = useAppSettingsStore(
    (state) => state.settings.pushNotifications,
  );
  const [permissionRefreshKey, setPermissionRefreshKey] = useState(0);
  const inFlightKeyRef = useRef<string | null>(null);

  useEffect(
    () => registerLogoutHandler(pushTokenRegistrationOrchestrator.logout),
    [],
  );

  // iOS 的来电走单独登记的 PushKit VoIP token：跟普通推送同一个开关、同一套登出撤销。
  useEffect(() => {
    const voip = getVoipPushTokenRegistrationOrchestrator();
    return voip ? registerLogoutHandler(voip.logout) : undefined;
  }, []);

  useEffect(() => subscribeVoipTokenChanges(() => {
    setPermissionRefreshKey((value) => value + 1);
  }), []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setPermissionRefreshKey((value) => value + 1);
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => subscribeJPushConnection(() => {
    setPermissionRefreshKey((value) => value + 1);
  }), []);

  useEffect(() => {
    let cancelled = false;
    const runKey = `${userId}:${pushEnabled}:${permissionRefreshKey}`;
    if (inFlightKeyRef.current === runKey) return;
    inFlightKeyRef.current = runKey;

    void pushTokenRegistrationOrchestrator
      .sync({
        isAuthenticated,
        userId,
        pushEnabled,
        isCancelled: () => cancelled,
      })
      .catch((error) => {
        reportNotificationFailure('push_token_register_failed', error, {
          platform: Platform.OS,
        });
      });
    void getVoipPushTokenRegistrationOrchestrator()
      ?.sync({
        isAuthenticated,
        userId,
        pushEnabled,
        isCancelled: () => cancelled,
      })
      .catch((error) => {
        reportNotificationFailure('push_token_register_failed', error, {
          platform: Platform.OS,
          provider: 'apns_voip',
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
