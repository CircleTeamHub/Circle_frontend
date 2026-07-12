import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { registerLogoutHandler } from '@/services/auth/session';
import { useAuthStore } from '@/stores/authStore';
import { useAppSettingsStore } from '@/features/profile/store/use-app-settings-store';
import { reportNotificationFailure } from '@/features/notifications/utils/report-failure';
import { pushTokenRegistrationOrchestrator } from '@/features/notifications/services/push-token-registration';

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

    return () => {
      cancelled = true;
      if (inFlightKeyRef.current === runKey) {
        inFlightKeyRef.current = null;
      }
    };
  }, [isAuthenticated, permissionRefreshKey, pushEnabled, userId]);

  return null;
}
