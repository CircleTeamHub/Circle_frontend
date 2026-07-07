import { useCallback, useEffect, useRef } from 'react';
import {
  usePathname,
  useRootNavigationState,
  useRouter,
  type Href,
} from 'expo-router';
import { resolvePushNotificationRoute } from '@/features/notifications/utils/push-notification-route';
import { logClientDiagnostic } from '@/utils/client-diagnostics';
import { useAuthStore } from '@/stores/authStore';

type NotificationsModule = typeof import('expo-notifications');
type NotificationResponse = Awaited<
  ReturnType<NotificationsModule['getLastNotificationResponseAsync']>
>;

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
// 去重已处理响应的 id 集合上限：长会话里点过的通知会持续累积，
// 保留最近 HANDLED_LIMIT 个足以覆盖「冷启动 getLast + listener 双触发」的去重窗口。
const HANDLED_LIMIT = 300;

function rememberHandled(set: Set<string>, key: string) {
  set.add(key);
  if (set.size > HANDLED_LIMIT) {
    // Set 保持插入顺序，淘汰最早进入的，避免无界增长。
    const oldest = set.values().next().value;
    if (oldest !== undefined) set.delete(oldest);
  }
}

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
  // 根导航栈就绪前 router.push 会丢失（冷启动深链常见）；navState.key 存在即就绪。
  const navState = useRootNavigationState();
  const navReady = Boolean(navState?.key);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const pathnameRef = useRef(pathname);
  const navReadyRef = useRef(navReady);
  const authedRef = useRef(isAuthenticated);
  const handledRef = useRef(new Set<string>());
  // 导航未就绪 / 未登录时暂存目标路由，待两者都满足再跳（见下方 flush effect）。
  const pendingRouteRef = useRef<Href | null>(null);
  pathnameRef.current = pathname;
  navReadyRef.current = navReady;
  authedRef.current = isAuthenticated;

  const navigate = useCallback(
    (route: Href) => {
      if (isAlreadyOnTarget(pathnameRef.current, route)) {
        router.replace(route);
      } else {
        router.push(route);
      }
    },
    [router],
  );

  // 导航就绪 + 已登录后，flush 暂存的冷启动/登出期间收到的深链。
  useEffect(() => {
    if (navReady && isAuthenticated && pendingRouteRef.current) {
      const route = pendingRouteRef.current;
      pendingRouteRef.current = null;
      navigate(route);
    }
  }, [navReady, isAuthenticated, navigate]);

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

      rememberHandled(handledRef.current, key);
      logClientDiagnostic('notification_open', {
        source: 'system_push',
        notificationId: key,
      });
      // 未登录：不把用户推进受保护区（AuthRouteGuard 会兜底到登录），
      // 但把目标暂存，登录后 flush，避免深链丢失。
      // 导航未就绪（冷启动）：同样暂存，就绪后 flush。
      if (navReadyRef.current && authedRef.current) {
        navigate(route);
      } else {
        pendingRouteRef.current = route;
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
  }, [navigate]);

  return null;
}
