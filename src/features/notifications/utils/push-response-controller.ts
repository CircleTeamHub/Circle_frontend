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
};

type ControllerDependencies = {
  resolveRoute: (data: PushData) => Href | null;
  navigate: (route: Href) => void;
  markReadLocal: (notificationId: string) => void;
  markReadRemote: (notificationId: string) => Promise<void>;
  reportFailure: (error: unknown, notificationId: string) => void;
  logOpen: (requestIdentifier: string) => void;
};

const HANDLED_LIMIT = 300;
const PENDING_LIMIT = 50;

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
  const handled = new Set<string>();
  let navReady = false;
  let authenticated = false;
  const pending: PendingResponse[] = [];
  let flushing = false;

  const remember = (identifier: string) => {
    handled.add(identifier);
    if (handled.size <= HANDLED_LIMIT) return;
    const oldest = handled.values().next().value;
    if (oldest !== undefined) handled.delete(oldest);
  };

  const open = ({ route, notificationId }: PendingResponse) => {
    if (notificationId) {
      deps.markReadLocal(notificationId);
      try {
        void deps.markReadRemote(notificationId).catch((error) => {
          deps.reportFailure(error, notificationId);
        });
      } catch (error) {
        deps.reportFailure(error, notificationId);
      }
    }
    deps.navigate(route);
  };

  const flush = () => {
    if (!navReady || !authenticated || flushing) return;
    flushing = true;
    try {
      while (pending.length > 0) {
        const item = pending.shift();
        if (item) open(item);
      }
    } finally {
      flushing = false;
    }
  };

  return {
    setReadiness(nextNavReady: boolean, nextAuthenticated: boolean) {
      navReady = nextNavReady;
      authenticated = nextAuthenticated;
      flush();
    },

    handleResponse(response: PushNotificationResponse | null | undefined) {
      if (!response) return;
      const request = response.notification.request;
      if (handled.has(request.identifier)) return;
      const data = request.content.data ?? {};
      const route = deps.resolveRoute(data);
      if (!route) return;

      remember(request.identifier);
      deps.logOpen(request.identifier);
      const item = {
        route,
        notificationId: text(data.notificationId),
        requestIdentifier: request.identifier,
      };
      if (navReady && authenticated) {
        open(item);
      } else {
        pending.push(item);
        if (pending.length > PENDING_LIMIT) {
          const dropped = pending.shift();
          if (dropped) handled.delete(dropped.requestIdentifier);
        }
      }
    },
  };
}
