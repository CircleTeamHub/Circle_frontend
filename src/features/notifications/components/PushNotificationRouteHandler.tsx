import { useEffect, useRef } from 'react';
import { usePathname, useRouter, type Href } from 'expo-router';
import { resolvePushNotificationRoute } from '@/features/notifications/utils/push-notification-route';
import { logClientDiagnostic } from '@/utils/client-diagnostics';

type NotificationsModule = typeof import('expo-notifications');
type NotificationResponse = Awaited<
  ReturnType<NotificationsModule['getLastNotificationResponseAsync']>
>;

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

function responseKey(response: NonNullable<NotificationResponse>) {
  return response.notification.request.identifier;
}

function routeParam(route: Href, key: string) {
  if (typeof route === 'string') return '';
  const value = route.params?.[key];
  return typeof value === 'string' ? value : '';
}

function isAlreadyOnTarget(pathname: string, route: Href) {
  const target = typeof route === 'string' ? route : route.pathname;
  if (target === '/(tabs)/messages') return pathname === '/messages';
  if (target === '/(tabs)/contacts/new-friends') {
    return pathname === '/contacts/new-friends';
  }
  if (target === '/(tabs)/messages/notifications') {
    return pathname === '/messages/notifications';
  }
  if (target === '/(tabs)/messages/post-signups') {
    return pathname === '/messages/post-signups';
  }
  if (target === '/(tabs)/profile/system-announcements') {
    return pathname === '/profile/system-announcements';
  }
  if (target === '/(tabs)/messages/chat-detail') {
    return pathname === '/messages/chat-detail';
  }
  if (target === '/(tabs)/discover/moment/[id]') {
    return pathname === `/discover/moment/${encodeURIComponent(routeParam(route, 'id'))}`;
  }
  if (target === '/(tabs)/discover/verification/[id]') {
    return pathname === `/discover/verification/${encodeURIComponent(routeParam(route, 'id'))}`;
  }
  if (target === '/(tabs)/discover/invitation/[id]') {
    return pathname === `/discover/invitation/${encodeURIComponent(routeParam(route, 'id'))}`;
  }
  return false;
}

export function PushNotificationRouteHandler() {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const handledRef = useRef(new Set<string>());
  pathnameRef.current = pathname;

  useEffect(() => {
    let mounted = true;
    let subscription: { remove: () => void } | null = null;

    const handleResponse = (response: NotificationResponse) => {
      if (!response) return;
      const key = responseKey(response);
      if (handledRef.current.has(key)) return;

      const route = resolvePushNotificationRoute(
        response.notification.request.content.data ?? {},
      );
      if (!route) return;

      handledRef.current.add(key);
      logClientDiagnostic('notification_open', {
        source: 'system_push',
        notificationId: key,
      });
      if (isAlreadyOnTarget(pathnameRef.current, route)) {
        router.replace(route);
      } else {
        router.push(route);
      }
    };

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
          handleResponse(notifications.getLastNotificationResponse());
          notifications.clearLastNotificationResponse();
        } catch (error) {
          if (isDev) {
            console.warn('[notifications] get last response failed', error);
          }
        }
        subscription = notifications.addNotificationResponseReceivedListener(
          handleResponse,
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
  }, [router]);

  return null;
}
