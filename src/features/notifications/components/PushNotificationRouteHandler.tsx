import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
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
import { initializePushResponseListener } from '@/features/notifications/utils/push-response-listener';
import { reportNotificationFailure } from '@/features/notifications/utils/report-failure';
import { useNotificationCenterStore } from '@/features/notifications/store/use-notification-center-store';
import {
  markNotificationRead,
  verifyNotificationOpenOwnership,
} from '@/services/api/notifications';
import { logClientDiagnostic } from '@/utils/client-diagnostics';
import { useAuthStore } from '@/stores/authStore';
import { devWarn } from '@/utils/dev-log';
import { reportHandledFailure } from '@/observability/report-failure';

export function PushNotificationRouteHandler() {
  const router = useRouter();
  const pathname = usePathname();
  const navState = useRootNavigationState();
  const navReady = Boolean(navState?.key);
  const authenticatedUserId = useAuthStore((state) =>
    state.isAuthenticated ? (state.user?.id ?? null) : null,
  );

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
      verifyOpenOwnership: verifyNotificationOpenOwnership,
      reportFailure: (error, notificationId, stage, requestIdentifier) => {
        if (stage === 'local-read' || stage === 'remote-read') {
          reportNotificationFailure('notification_mark_read_failed', error, {
            notificationId,
            source: 'system_push',
            stage,
          });
          return;
        }
        // 点了推送却跳不过去 —— 推送的全部意义所在。route 由服务端下发的 payload
        // 推导，后端加一个客户端还没有对应 screen 的通知类型就会全量踩中。
        if (stage === 'navigate') {
          reportNotificationFailure('notification_navigate_failed', error, {
            notificationId,
            source: 'system_push',
          });
          return;
        }
        // 归属校验走 apiClient，多数是 ApiError（已由 client.ts 上报）；这里交给
        // reportNotificationFailure 的闸自己判，剩下的裸错误才会出去。
        if (stage === 'ownership-verify') {
          reportNotificationFailure(
            'notification_ownership_verify_failed',
            error,
            { notificationId, source: 'system_push' },
          );
          return;
        }
        // 'log-open'：logOpen 底层是 logClientDiagnostic，生产里第一行就 return，
        // 不可能抛。留 dev 线索即可，接 Sentry 只会是死代码。
        logClientDiagnostic('notification_response_failed', {
          source: 'system_push',
          requestIdentifier,
          stage,
        });
        devWarn('[notifications] response handling failed', error);
      },
      reportDrop: (reason, requestIdentifier) => {
        // 只报「这次 tap 被终态放弃」的两种：
        // - navigate-failed：重试耗尽。上面 'navigate' 那条虽然带 stack，但它在
        //   「抛一次后重试成功」（用户只是卡一下）和「抛三次被永久丢弃」（点了永远
        //   没反应）两种情况下完全一样——去重后连次数都看不出来。严重度的差别只能
        //   由这条终态事件表达。
        // - missing-legacy-notification-id：payload 既无 toUserId 又无
        //   notificationId，后端契约破损，全量用户点了都没反应。
        // 其余都是设计内的正常行为，报了纯噪音：account-mismatch（切号后收到旧号的
        // 推送）、ownership-denied（后端判定非本人）、ownership-account-changed
        // （校验期间切号）；ownership-failed 的 error 已由 'ownership-verify' 报过。
        if (reason === 'navigate-failed') {
          reportNotificationFailure(
            'notification_navigate_abandoned',
            new Error(`push tap dropped: ${reason}`),
            { source: 'system_push', reason },
          );
        } else if (reason === 'missing-legacy-notification-id') {
          reportNotificationFailure(
            'notification_payload_invalid',
            new Error(`push payload dropped: ${reason}`),
            { source: 'system_push', reason },
          );
        }
        logClientDiagnostic('notification_response_dropped', {
          source: 'system_push',
          requestIdentifier,
          reason,
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
    controller.setReadiness(navReady, authenticatedUserId);
  }, [controller, navReady, authenticatedUserId]);

  useEffect(() => {
    // Web 没有"点系统推送打开 App"这条链路（expo-notifications 的
    // getLastNotificationResponse 在 web 直接抛），整个监听不装。
    if (Platform.OS === 'web') return;
    let mounted = true;
    let subscription: { remove: () => void } | null = null;
    controller.activate();

    void import('expo-notifications')
      .then((notifications) => {
        if (!mounted) return;
        subscription = initializePushResponseListener(
          notifications,
          controller.handleResponse,
          (error) => {
            reportHandledFailure('notifications', 'getLastResponse', error);
          },
        );
        notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowBanner: false,
            shouldShowList: true,
            shouldPlaySound: false,
            shouldSetBadge: true,
          }),
        });
      })
      .catch((error) => {
        reportHandledFailure('notifications', 'responseListenerUnavailable', error);
      });

    return () => {
      mounted = false;
      subscription?.remove();
      controller.dispose();
    };
  }, [controller]);

  return null;
}
