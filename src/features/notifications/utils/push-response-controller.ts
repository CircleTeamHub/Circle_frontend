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
  targetUserId: string;
  openAttempts: number;
};

type FailureStage = 'navigate' | 'log-open' | 'local-read' | 'remote-read';
type DropReason =
  | 'account-mismatch'
  | 'missing-target-user'
  | 'navigate-failed';

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
  const value = route.params?.[key];
  return typeof value === 'string' ? value : '';
}

export function isAlreadyOnPushTarget(pathname: string, route: Href) {
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
      cancelScheduledRetry();
    },

    setReadiness(nextNavReady: boolean, nextUserId: string | null) {
      navReady = nextNavReady;
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
      if (!targetUserId) {
        remember(request.identifier);
        safeReportDrop('missing-target-user', request.identifier);
        return;
      }
      if (currentUserId && targetUserId !== currentUserId) {
        remember(request.identifier);
        safeReportDrop('account-mismatch', request.identifier);
        return;
      }

      const item = {
        route,
        notificationId: text(data.notificationId),
        requestIdentifier: request.identifier,
        targetUserId,
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
