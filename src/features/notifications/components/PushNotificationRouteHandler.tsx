import { useEffect, useRef } from 'react';
import {
  usePathname,
  useRootNavigationState,
  useRouter,
  type Href,
} from 'expo-router';
import { resolvePushNotificationRoute } from '@/features/notifications/utils/push-notification-route';
import {
  createPushResponseController,
  isAlreadyOnPushTarget,
} from '@/features/notifications/utils/push-response-controller';
import { reportNotificationFailure } from '@/features/notifications/utils/report-failure';
import { useNotificationCenterStore } from '@/features/notifications/store/use-notification-center-store';
import { markNotificationRead } from '@/services/api/notifications';
import { logClientDiagnostic } from '@/utils/client-diagnostics';
import { useAuthStore } from '@/stores/authStore';

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

export function PushNotificationRouteHandler() {
  const router = useRouter();
  const pathname = usePathname();
  const navState = useRootNavigationState();
  const navReady = Boolean(navState?.key);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const routerRef = useRef(router);
  const pathnameRef = useRef(pathname);
  routerRef.current = router;
  pathnameRef.current = pathname;

  const controllerRef = useRef<ReturnType<
    typeof createPushResponseController
  > | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createPushResponseController({
      resolveRoute: resolvePushNotificationRoute,
      navigate: (route: Href) => {
        if (isAlreadyOnPushTarget(pathnameRef.current, route)) {
          routerRef.current.replace(route);
        } else {
          routerRef.current.push(route);
        }
      },
      markReadLocal: (notificationId) => {
        useNotificationCenterStore
          .getState()
          .markInteractiveReadLocal(notificationId);
      },
      markReadRemote: markNotificationRead,
      reportFailure: (error, notificationId) => {
        reportNotificationFailure('notification_mark_read_failed', error, {
          notificationId,
          source: 'system_push',
        });
      },
      logOpen: (requestIdentifier) => {
        logClientDiagnostic('notification_open', {
          source: 'system_push',
          requestIdentifier,
        });
      },
    });
  }
  const controller = controllerRef.current;

  useEffect(() => {
    controller.setReadiness(navReady, isAuthenticated);
  }, [controller, navReady, isAuthenticated]);

  useEffect(() => {
    let mounted = true;
    let subscription: { remove: () => void } | null = null;

    void import('expo-notifications')
      .then((notifications) => {
        if (!mounted) return;
        notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowBanner: false,
            shouldShowList: true,
            shouldPlaySound: false,
            shouldSetBadge: true,
          }),
        });
        try {
          controller.handleResponse(
            notifications.getLastNotificationResponse(),
          );
          notifications.clearLastNotificationResponse();
        } catch (error) {
          if (isDev) {
            console.warn('[notifications] get last response failed', error);
          }
        }
        subscription = notifications.addNotificationResponseReceivedListener(
          controller.handleResponse,
        );
      })
      .catch((error) => {
        if (isDev) {
          console.warn('[notifications] response listener unavailable', error);
        }
      });

    return () => {
      mounted = false;
      subscription?.remove();
    };
  }, [controller]);

  return null;
}
