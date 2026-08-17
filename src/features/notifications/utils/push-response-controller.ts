import type { Href } from 'expo-router';

type PushData = Record<string, unknown>;

export type PushNotificationResponse = {
  notification: {
    request: {
      identifier: string;
      content: { data?: PushData | null };
    };
  };
};

type PendingResponse = {
  route: Href;
  notificationId: string;
  requestIdentifier: string;
  targetUserId: string | null;
  ownershipState: 'not-required' | 'idle' | 'verifying' | 'verified';
  openAttempts: number;
};

type FailureStage =
  | 'navigate'
  | 'log-open'
  | 'local-read'
  | 'remote-read'
  | 'ownership-verify';
type DropReason =
  | 'account-mismatch'
  | 'missing-legacy-notification-id'
  | 'navigate-failed'
  | 'ownership-account-changed'
  | 'ownership-denied'
  | 'ownership-failed';

type ControllerDependencies = {
  resolveRoute: (data: PushData) => Href | null;
  navigate: (route: Href) => void;
  markReadLocal: (notificationId: string) => void;
  markReadRemote: (notificationId: string) => Promise<void>;
  reportFailure: (
    error: unknown,
    notificationId: string,
    stage: FailureStage,
    requestIdentifier: string,
  ) => void;
  reportDrop: (reason: DropReason, requestIdentifier: string) => void;
  logOpen: (requestIdentifier: string) => void;
  verifyOpenOwnership: (
    notificationId: string,
  ) => Promise<{ owned: boolean }>;
  scheduleRetry?: (callback: () => void, delayMs: number) => () => void;
};

const HANDLED_LIMIT = 300;
const PENDING_LIMIT = 50;
const MAX_OPEN_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [50, 150] as const;

function text(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function routeParam(route: Href, key: string) {
  if (typeof route === 'string') return '';
  // 先坍成普通 Record 再索引:直接在 Href 巨型联合的 params 上做索引表达式,
  // 路由每多几条就可能再次触发 TS2590(联合过大),与 scan-result.ts 同款规避。
  const params = route.params as Record<string, unknown> | undefined;
  const value = params?.[key];
  return typeof value === 'string' ? value : '';
}

export function isAlreadyOnPushTarget(pathname: string, route: Href) {
  const target =
    typeof route === 'string'
      ? route
      : (route as { pathname: string }).pathname;
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
  if (target === '/(tabs)/messages/user/[id]') {
    return pathname === `/messages/user/${encodeURIComponent(routeParam(route, 'id'))}`;
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

export function createPushResponseController(deps: ControllerDependencies) {
  const handledIds = new Set<string>();
  const queuedIds = new Set<string>();
  let navReady = false;
  let currentUserId: string | null = null;
  const pending: PendingResponse[] = [];
  let flushing = false;
  let disposed = false;
  let lifecycleGeneration = 0;
  let accountGeneration = 0;
  let cancelRetry: (() => void) | null = null;
  const scheduleRetry =
    deps.scheduleRetry ??
    ((callback: () => void, delayMs: number) => {
      const timer = setTimeout(callback, delayMs);
      return () => clearTimeout(timer);
    });

  const remember = (identifier: string) => {
    handledIds.add(identifier);
    if (handledIds.size <= HANDLED_LIMIT) return;
    const oldest = handledIds.values().next().value;
    if (oldest !== undefined) handledIds.delete(oldest);
  };

  const safeReport = (
    error: unknown,
    item: PendingResponse,
    stage: FailureStage,
  ) => {
    try {
      deps.reportFailure(
        error,
        item.notificationId,
        stage,
        item.requestIdentifier,
      );
    } catch {
      // Reporting must never alter push response state or navigation.
    }
  };

  const safeReportDrop = (
    reason: DropReason,
    requestIdentifier: string,
  ) => {
    try {
      deps.reportDrop(reason, requestIdentifier);
    } catch {
      // A diagnostic sink failure must not revive a terminally dropped tap.
    }
  };

  const terminalDrop = (item: PendingResponse, reason: DropReason) => {
    const index = pending.indexOf(item);
    if (index >= 0) pending.splice(index, 1);
    queuedIds.delete(item.requestIdentifier);
    remember(item.requestIdentifier);
    safeReportDrop(reason, item.requestIdentifier);
  };

  const verifyLegacyOwnership = (item: PendingResponse, userId: string) => {
    if (item.ownershipState !== 'idle') return;
    item.ownershipState = 'verifying';
    const startedLifecycleGeneration = lifecycleGeneration;
    const startedAccountGeneration = accountGeneration;

    let verification: Promise<{ owned: boolean }>;
    try {
      verification = deps.verifyOpenOwnership(item.notificationId);
    } catch (error) {
      safeReport(error, item, 'ownership-verify');
      terminalDrop(item, 'ownership-failed');
      return;
    }

    void verification
      .then(({ owned }) => {
        if (
          disposed ||
          lifecycleGeneration !== startedLifecycleGeneration ||
          !queuedIds.has(item.requestIdentifier)
        ) {
          return;
        }
        if (
          accountGeneration !== startedAccountGeneration ||
          currentUserId !== userId
        ) {
          terminalDrop(item, 'ownership-account-changed');
          flush();
          return;
        }
        if (!owned) {
          terminalDrop(item, 'ownership-denied');
          flush();
          return;
        }
        item.targetUserId = userId;
        item.ownershipState = 'verified';
        flush();
      })
      .catch((error) => {
        if (
          disposed ||
          lifecycleGeneration !== startedLifecycleGeneration ||
          !queuedIds.has(item.requestIdentifier)
        ) {
          return;
        }
        if (
          accountGeneration !== startedAccountGeneration ||
          currentUserId !== userId
        ) {
          terminalDrop(item, 'ownership-account-changed');
        } else {
          safeReport(error, item, 'ownership-verify');
          terminalDrop(item, 'ownership-failed');
        }
        flush();
      });
  };

  const cancelScheduledRetry = () => {
    cancelRetry?.();
    cancelRetry = null;
  };

  const scheduleOpenRetry = (attempts: number) => {
    if (cancelRetry || disposed) return;
    const delay =
      RETRY_DELAYS_MS[
        Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)
      ];
    cancelRetry = scheduleRetry(() => {
      cancelRetry = null;
      if (!disposed) flush();
    }, delay);
  };

  const dispatch = (item: PendingResponse) => {
    try {
      deps.navigate(item.route);
    } catch (error) {
      item.openAttempts += 1;
      safeReport(error, item, 'navigate');
      if (item.openAttempts >= MAX_OPEN_ATTEMPTS) {
        queuedIds.delete(item.requestIdentifier);
        remember(item.requestIdentifier);
        safeReportDrop('navigate-failed', item.requestIdentifier);
        return 'drop' as const;
      }
      scheduleOpenRetry(item.openAttempts);
      return 'retry' as const;
    }

    queuedIds.delete(item.requestIdentifier);
    remember(item.requestIdentifier);
    try {
      deps.logOpen(item.requestIdentifier);
    } catch (error) {
      safeReport(error, item, 'log-open');
    }

    const { notificationId } = item;
    if (notificationId) {
      try {
        deps.markReadLocal(notificationId);
      } catch (error) {
        safeReport(error, item, 'local-read');
      }
      try {
        void deps.markReadRemote(notificationId).catch((error) => {
          safeReport(error, item, 'remote-read');
        });
      } catch (error) {
        safeReport(error, item, 'remote-read');
      }
    }
    return 'success' as const;
  };

  function flush() {
    if (disposed || !navReady || !currentUserId || flushing) return;
    cancelScheduledRetry();
    flushing = true;
    try {
      for (let index = 0; index < pending.length; ) {
        const item = pending[index];
        if (!item.targetUserId) {
          if (item.ownershipState === 'idle') {
            verifyLegacyOwnership(item, currentUserId);
          }
          break;
        }
        if (item.targetUserId !== currentUserId) {
          index += 1;
          continue;
        }
        const result = dispatch(item);
        if (result === 'retry') break;
        pending.splice(index, 1);
      }
    } finally {
      flushing = false;
    }
  }

  return {
    activate() {
      disposed = false;
      flush();
    },

    dispose() {
      disposed = true;
      lifecycleGeneration += 1;
      for (const item of pending) {
        if (item.ownershipState === 'verifying') {
          item.ownershipState = 'idle';
        }
      }
      cancelScheduledRetry();
    },

    setReadiness(nextNavReady: boolean, nextUserId: string | null) {
      navReady = nextNavReady;
      if (currentUserId !== nextUserId) accountGeneration += 1;
      currentUserId = nextUserId;
      flush();
    },

    handleResponse(response: PushNotificationResponse | null | undefined) {
      if (disposed || !response) return;
      const request = response.notification.request;
      if (handledIds.has(request.identifier)) return;
      if (queuedIds.has(request.identifier)) {
        flush();
        return;
      }
      const data = request.content.data ?? {};
      const route = deps.resolveRoute(data);
      if (!route) return;

      const targetUserId = text(data.toUserId);
      const notificationId = text(data.notificationId);
      if (!targetUserId && !notificationId) {
        remember(request.identifier);
        safeReportDrop('missing-legacy-notification-id', request.identifier);
        return;
      }
      if (
        targetUserId &&
        currentUserId &&
        targetUserId !== currentUserId
      ) {
        remember(request.identifier);
        safeReportDrop('account-mismatch', request.identifier);
        return;
      }

      const item: PendingResponse = {
        route,
        notificationId,
        requestIdentifier: request.identifier,
        targetUserId: targetUserId || null,
        ownershipState: targetUserId ? 'not-required' : 'idle',
        openAttempts: 0,
      };
      queuedIds.add(request.identifier);
      pending.push(item);
      if (pending.length > PENDING_LIMIT) {
        const dropped = pending.shift();
        if (dropped) queuedIds.delete(dropped.requestIdentifier);
      }
      flush();
    },
  };
}
