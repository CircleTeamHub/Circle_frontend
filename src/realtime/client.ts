import { REALTIME_WS_URL } from '@/constants/config';
import { fetchMySignupsUnreadCount } from '@/services/api/plaza';
import { fetchUnreadFriendActivityCount } from '@/services/api/friends';
import { fetchCurrentUser } from '@/services/api/auth';
import { fetchNotificationUnreadSummary } from '@/services/api/notifications';
import { useNotificationCenterStore } from '@/features/notifications/store/use-notification-center-store';
import { useNotificationSnackbarStore } from '@/features/notifications/store/use-notification-snackbar-store';
import { registerLogoutHandler } from '@/services/auth/session';
import { useAuthStore } from '@/stores/authStore';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { useWalletRealtimeStore } from '@/stores/walletRealtimeStore';
import type { NotificationItem } from '@/types';

type BadgeSnapshotPayload = {
  messagesUnread?: number;
  contactsUnread?: number;
  discoverUnread?: number;
  signupUnread?: number;
  profileUnread?: number;
  systemUnread?: number;
};

type RealtimeEvent =
  | {
      type: 'badge.snapshot';
      payload?: BadgeSnapshotPayload;
    }
  | {
      type: 'notification.created';
      payload?: NotificationItem;
    }
  | {
      type: 'friend.activity.unread.changed';
      payload?: { count?: number };
    }
  | {
      type: 'interaction.unread.changed';
      payload?: { count?: number };
    }
  | {
      type: 'circle.signup.unread.changed';
      payload?: { count?: number };
    }
  | {
      type: 'membership.status.changed';
      payload?: { vipLevel?: number };
    }
  | {
      type: 'wallet.balance.changed';
      payload?: { balance?: number };
    }
  | {
      type: 'wallet.recharge.completed';
      payload?: { balance?: number };
    }
  | {
      type: 'system.notification.unread.changed';
      payload?: { count?: number };
    }
  | {
      type: 'user.profile.summary.changed';
      payload?: { vipLevel?: number; creditScore?: number; displayIconsVersion?: number };
    }
  | {
      type: 'circle.post.interaction.created';
      payload?: { traceId?: string; commentId?: string };
    }
  | {
      type: 'circle.invitation.reviewed';
      payload?: { invitationId?: string; status?: string };
    }
  | {
      type: 'system.notification.created';
      payload?: { content?: string };
    };

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 10;

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let currentToken: string | null = null;
let manualDisconnect = false;
let reconnectAttempt = 0;

function clearReconnectTimer() {
  if (!reconnectTimer) {
    return;
  }

  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function buildRealtimeUrl(token: string) {
  const separator = REALTIME_WS_URL.includes('?') ? '&' : '?';
  return `${REALTIME_WS_URL}${separator}token=${encodeURIComponent(token)}`;
}

function scheduleReconnect() {
  if (manualDisconnect || !currentToken || reconnectTimer) {
    return;
  }

  if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
    return;
  }

  const baseDelay = Math.min(
    RECONNECT_BASE_MS * Math.pow(2, reconnectAttempt),
    RECONNECT_MAX_MS,
  );
  const jitter = baseDelay * 0.2 * Math.random();
  const delay = baseDelay + jitter;

  reconnectAttempt += 1;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    const token = currentToken;
    if (!token) {
      return;
    }

    connectRealtime(token);
  }, delay);
}

function closeSocket() {
  if (!socket) {
    return;
  }

  socket.onopen = null;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;

  if (
    socket.readyState === WebSocket.OPEN ||
    socket.readyState === WebSocket.CONNECTING
  ) {
    socket.close();
  }

  socket = null;
}

function applyBadgeSnapshot(snapshot: BadgeSnapshotPayload) {
  const badgeStore = useTabBadgeStore.getState();
  badgeStore.applySnapshot({
    messagesUnread: badgeStore.messagesUnread,
    contactsUnread: snapshot.contactsUnread,
    discoverUnread: snapshot.discoverUnread,
    signupUnread: snapshot.signupUnread,
    profileUnread: snapshot.profileUnread,
    systemUnread: snapshot.systemUnread,
  });
}

async function refreshCurrentUserSummary() {
  const user = await fetchCurrentUser();
  useAuthStore.getState().setUser(user);
}

function isNotificationItem(value: unknown): value is NotificationItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<NotificationItem>;
  return (
    typeof item.id === 'string' &&
    typeof item.type === 'string' &&
    typeof item.content === 'string' &&
    typeof item.read === 'boolean' &&
    typeof item.createdAt === 'string'
  );
}

function handleNotificationCreated(payload: unknown) {
  if (!isNotificationItem(payload)) {
    return;
  }

  // SYSTEM notifications are not part of the interactive list and have no
  // in-app landing screen, so toasting one would route nowhere. Skip them.
  if (payload.type === 'SYSTEM') {
    return;
  }

  const store = useNotificationCenterStore.getState();
  store.setInteractive([
    payload,
    ...store.interactive.filter((item) => item.id !== payload.id),
  ]);
  useNotificationSnackbarStore.getState().enqueueNotification(payload);
}

function handleRealtimeEvent(message: RealtimeEvent) {
  const badgeStore = useTabBadgeStore.getState();

  switch (message.type) {
    case 'badge.snapshot':
      applyBadgeSnapshot(message.payload ?? {});
      return;
    case 'notification.created':
      handleNotificationCreated(message.payload);
      return;
    case 'friend.activity.unread.changed':
      badgeStore.setContactsUnread(message.payload?.count ?? 0);
      return;
    case 'interaction.unread.changed':
      badgeStore.setDiscoverUnread(message.payload?.count ?? 0);
      return;
    case 'circle.signup.unread.changed':
      badgeStore.setSignupUnread(message.payload?.count ?? 0);
      return;
    case 'membership.status.changed':
      void refreshCurrentUserSummary();
      return;
    case 'wallet.balance.changed':
      // store 内部还会再校验 NaN / Infinity / 负数；这里只过一次类型门槛。
      if (typeof message.payload?.balance === 'number') {
        useWalletRealtimeStore.getState().setRealtimeBalance(message.payload.balance);
      }
      return;
    case 'wallet.recharge.completed':
      if (typeof message.payload?.balance === 'number') {
        useWalletRealtimeStore.getState().setRealtimeBalance(message.payload.balance);
      }
      return;
    case 'system.notification.unread.changed':
      badgeStore.setProfileUnread(message.payload?.count ?? 0);
      badgeStore.setSystemUnread(message.payload?.count ?? 0);
      return;
    case 'user.profile.summary.changed':
      void refreshCurrentUserSummary();
      return;
    case 'circle.post.interaction.created':
      return;
    case 'circle.invitation.reviewed':
      return;
    case 'system.notification.created':
      return;
    default:
      return;
  }
}

function handleSocketMessage(rawData: string) {
  try {
    const message = JSON.parse(rawData) as RealtimeEvent;
    handleRealtimeEvent(message);
  } catch (err) {
    // Ignore malformed realtime messages to keep the connection alive — but dev-log
    // 出来，避免后端推一坨脏数据时本地长期静默丢消息。
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[realtime] dropped malformed message', err);
    }
  }
}

const RECOVERY_THROTTLE_MS = 30_000;
let lastRecoveryAt = 0;

export async function recoverTabBadgeSnapshot() {
  const now = Date.now();
  if (now - lastRecoveryAt < RECOVERY_THROTTLE_MS) {
    return;
  }
  lastRecoveryAt = now;

  try {
    const [contactsUnread, signupUnread, notificationSummary] =
      await Promise.all([
        fetchUnreadFriendActivityCount(),
        fetchMySignupsUnreadCount(),
        fetchNotificationUnreadSummary(),
      ]);

    applyBadgeSnapshot({
      contactsUnread,
      discoverUnread: notificationSummary.discoverUnread,
      signupUnread,
      profileUnread: notificationSummary.profileUnread,
      systemUnread: notificationSummary.totalUnread,
    });
  } catch (err) {
    // Recovery is best-effort; keep the latest known badge state on failure.
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[realtime] badge snapshot recovery failed', err);
    }
  }
}

export function connectRealtime(token: string) {
  const normalizedToken = token.trim();

  if (!normalizedToken) {
    disconnectRealtime();
    return;
  }

  manualDisconnect = false;
  reconnectAttempt = 0;
  clearReconnectTimer();

  if (
    currentToken === normalizedToken &&
    socket &&
    (socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  currentToken = normalizedToken;
  closeSocket();

  const nextSocket = new WebSocket(buildRealtimeUrl(normalizedToken));
  socket = nextSocket;

  nextSocket.onopen = () => {
    reconnectAttempt = 0;
    useTabBadgeStore.getState().setRealtimeConnected(true);
  };

  nextSocket.onmessage = (event) => {
    if (typeof event.data !== 'string') {
      return;
    }

    handleSocketMessage(event.data);
  };

  nextSocket.onerror = () => {
    useTabBadgeStore.getState().setRealtimeConnected(false);
  };

  nextSocket.onclose = () => {
    if (socket === nextSocket) {
      socket = null;
    }

    useTabBadgeStore.getState().setRealtimeConnected(false);

    if (!manualDisconnect) {
      scheduleReconnect();
    }
  };
}

export function disconnectRealtime() {
  manualDisconnect = true;
  currentToken = null;
  clearReconnectTimer();
  useTabBadgeStore.getState().setRealtimeConnected(false);
  closeSocket();
}

// 注册到 session 的登出 teardown，避免 session.ts 反向 import 实时通道。
registerLogoutHandler(disconnectRealtime);
