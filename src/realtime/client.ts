import { REALTIME_WS_URL } from '@/constants/config';
import { fetchMySignupsUnreadCount } from '@/services/api/plaza';
import { fetchUnreadFriendActivityCount } from '@/services/api/friends';
import { fetchCurrentUser } from '@/services/api/auth';
import {
  fetchNotifications,
  fetchNotificationUnreadSummary,
} from '@/services/api/notifications';
import { useNotificationCenterStore } from '@/features/notifications/store/use-notification-center-store';
import { useNotificationSnackbarStore } from '@/features/notifications/store/use-notification-snackbar-store';
import { useCircleNotificationStore } from '@/features/discover/store/use-circle-notification-store';
import { useCallStore } from '@/features/call/store/use-call-store';
import { registerLogoutHandler } from '@/services/auth/session';
import { useAuthStore } from '@/stores/authStore';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { useWalletRealtimeStore } from '@/stores/walletRealtimeStore';
import type { NotificationItem } from '@/types';
import type {
  CallInvitePayload,
  CallParticipantPayload,
  CallStatePayload,
} from '@/features/call/types';
import {
  isCallInvitePayload,
  isCallParticipantPayload,
  isCallStatePayload,
} from '@/features/call/realtime-guards';

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
    }
  | {
      type: 'call.invite';
      payload?: CallInvitePayload;
    }
  | {
      type: 'call.participant.joined';
      payload?: CallParticipantPayload;
    }
  | {
      type: 'call.participant.left';
      payload?: CallParticipantPayload;
    }
  | {
      type: 'call.participant.rejected' | 'call.participant.missed';
      payload?: CallParticipantPayload;
    }
  | {
      type: 'call.ended' | 'call.canceled';
      payload?: CallStatePayload;
    };

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
// 退避指数封顶：2^5 * 1s 已经越过 RECONNECT_MAX_MS，再往上乘只会把 attempt
// 累到 Math.pow 溢出成 Infinity。封顶后延迟稳定停在 RECONNECT_MAX_MS。
const RECONNECT_MAX_EXPONENT = 5;

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let currentToken: string | null = null;
let manualDisconnect = false;
let reconnectAttempt = 0;
let reconnectRecoveryPending = false;

function clearReconnectTimer() {
  if (!reconnectTimer) {
    return;
  }

  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

// 注意：网关只认「消息帧认证」（连上后 10s 内发 {type:'auth',token}），
// URL query 里的 token 不会被读取（后端已移除 URL 认证以防 JWT 泄漏进日志）。
// 所以这里不往 URL 拼 token——认证在 onopen 里发帧完成。

function scheduleReconnect() {
  if (manualDisconnect || !currentToken || reconnectTimer) {
    return;
  }

  // 封顶的是「延迟」不是「次数」：后端滚动重启、隧道过夜、长时间断网都可能连续失败
  // 几十次。一旦就此永久放弃，来电邀请与红点在本次进程剩余时间里再也不会到达，且用户
  // 完全无感。登出（manualDisconnect）是唯一的永久终止条件；回到前台时
  // connectRealtime 会把 reconnectAttempt 归零并立刻重连。
  const baseDelay = Math.min(
    RECONNECT_BASE_MS *
      Math.pow(2, Math.min(reconnectAttempt, RECONNECT_MAX_EXPONENT)),
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

    reconnectRecoveryPending = true;
    // 走 openRealtimeSocket 而不是 connectRealtime：后者是「显式连接意图」的入口，
    // 会把 reconnectAttempt 归零 —— 从重连定时器里调它，退避就永远停在第一档，
    // 变成断网期间每秒锤一次后端。计数只由 onopen（连上了）归零。
    openRealtimeSocket(token);
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

function refreshCurrentUserSummaryBestEffort() {
  void refreshCurrentUserSummary().catch((err) => {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[realtime] profile summary refresh failed', err);
    }
  });
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

// 铃铛「互动」列表收录的类型 —— 镜像后端 DISCOVER_NOTIFICATION_TYPES
// (notification.constants.ts)。好友申请类有专属「新的朋友」收件箱
// (contactsUnread)，横幅照弹，但不得混进铃铛列表。
const BELL_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  'TRACE_LIKE',
  'TRACE_COMMENT',
  'COMMENT_REPLY',
  'TRACE_MENTION',
  'CIRCLE_VERIFICATION_REQUESTED',
  'CIRCLE_INVITATION_APPROVED',
  'CIRCLE_INVITATION_REJECTED',
  'CIRCLE_ADMIN_OVERRIDE_APPROVED',
  'CIRCLE_POST_PUBLISHED',
  'CIRCLE_POST_SIGNUP_CREATED',
  'CIRCLE_POST_AUTO_ENDED',
  'CIRCLE_POST_COLLABORATION_RECOGNIZED',
  'PROFILE_LIKE',
]);

function handleNotificationCreated(payload: unknown) {
  if (!isNotificationItem(payload)) {
    return;
  }

  // SYSTEM notifications are not part of the interactive list and have no
  // in-app landing screen, so toasting one would route nowhere. Skip them.
  if (payload.type === 'SYSTEM') {
    return;
  }

  if (BELL_NOTIFICATION_TYPES.has(payload.type)) {
    const store = useNotificationCenterStore.getState();
    store.setInteractive([
      payload,
      ...store.interactive.filter((item) => item.id !== payload.id),
    ]);
  }

  // 圈子通知（CIRCLE_*）的横幅受「圈子通知设置」控制：总开关或「通知提醒」关闭时，
  // 通知照常进铃铛列表 + 红点（上面已处理），但不弹横幅。非圈子通知不受影响。
  if (payload.type.startsWith('CIRCLE_')) {
    const { inAppEnabled, bannerEnabled } =
      useCircleNotificationStore.getState();
    if (!inAppEnabled || !bannerEnabled) {
      return;
    }
  }

  useNotificationSnackbarStore.getState().enqueueNotification(payload);
}

function mergeRecoveredInteractiveNotifications(items: NotificationItem[]) {
  if (items.length === 0) return;

  const store = useNotificationCenterStore.getState();
  const recoveredIds = new Set(items.map((item) => item.id));
  store.setInteractive([
    ...items,
    ...store.interactive.filter((item) => !recoveredIds.has(item.id)),
  ]);
}

function handleRealtimeEvent(message: RealtimeEvent) {
  const badgeStore = useTabBadgeStore.getState();
  const callStore = useCallStore.getState();

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
      refreshCurrentUserSummaryBestEffort();
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
      refreshCurrentUserSummaryBestEffort();
      return;
    case 'circle.post.interaction.created':
      return;
    case 'circle.invitation.reviewed':
      return;
    case 'system.notification.created':
      return;
    case 'call.invite':
      if (isCallInvitePayload(message.payload)) {
        callStore.handleCallInvite(message.payload);
      }
      return;
    case 'call.participant.joined':
      if (isCallParticipantPayload(message.payload)) {
        callStore.handleCallParticipantJoined(message.payload);
      }
      return;
    case 'call.participant.left':
      if (isCallParticipantPayload(message.payload)) {
        callStore.handleCallParticipantLeft(message.payload);
      }
      return;
    case 'call.participant.rejected':
      if (isCallParticipantPayload(message.payload)) {
        callStore.handleCallParticipantRejected(message.payload);
      }
      return;
    case 'call.participant.missed':
      if (isCallParticipantPayload(message.payload)) {
        callStore.handleCallParticipantMissed(message.payload);
      }
      return;
    case 'call.ended':
    case 'call.canceled':
      if (isCallStatePayload(message.payload)) {
        callStore.handleCallEnded(message.payload);
      }
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

export async function recoverTabBadgeSnapshot(options?: { force?: boolean }) {
  const now = Date.now();
  if (!options?.force && now - lastRecoveryAt < RECOVERY_THROTTLE_MS) {
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

  try {
    mergeRecoveredInteractiveNotifications(await fetchNotifications(1));
  } catch (err) {
    // Recovery is best-effort; the notification center screen still has its
    // own pull-to-refresh path if this list backfill fails.
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[realtime] notification list recovery failed', err);
    }
  }
}

function openRealtimeSocket(normalizedToken: string) {
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

  const nextSocket = new WebSocket(REALTIME_WS_URL);
  socket = nextSocket;

  nextSocket.onopen = () => {
    const shouldForceRecovery = reconnectRecoveryPending;
    reconnectRecoveryPending = false;
    reconnectAttempt = 0;
    // 必须先发认证帧，否则网关 10s 后以 1008 踢掉连接，且期间收不到任何事件。
    // 认证成功后网关会立刻回推一帧 badge.snapshot；这里再补一次 HTTP
    // recovery，把断线期间错过的 notification.created 列表项拉回来。
    try {
      nextSocket.send(JSON.stringify({ type: 'auth', token: normalizedToken }));
    } catch (err) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[realtime] failed to send auth frame', err);
      }
    }
    useTabBadgeStore.getState().setRealtimeConnected(true);
    void recoverTabBadgeSnapshot({ force: shouldForceRecovery });
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

/**
 * 显式的连接意图：登录 / token 轮换 / 回到前台。
 *
 * 这些时机都意味着「情况变了，现在就重试」，所以把退避归零并立刻建连；
 * 断线后的自动重连不走这里（见 scheduleReconnect），否则退避无法递增。
 */
export function connectRealtime(token: string) {
  const normalizedToken = token.trim();

  if (!normalizedToken) {
    disconnectRealtime();
    return;
  }

  manualDisconnect = false;
  reconnectAttempt = 0;
  clearReconnectTimer();
  openRealtimeSocket(normalizedToken);
}

export function disconnectRealtime() {
  manualDisconnect = true;
  currentToken = null;
  reconnectRecoveryPending = false;
  clearReconnectTimer();
  useTabBadgeStore.getState().setRealtimeConnected(false);
  closeSocket();
}

// 注册到 session 的登出 teardown，避免 session.ts 反向 import 实时通道。
registerLogoutHandler(disconnectRealtime);
