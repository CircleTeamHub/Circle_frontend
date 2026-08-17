import { REALTIME_WS_URL } from '@/constants/config';
import { reportError } from '@/observability/sentry';
import { fetchMySignupsUnreadCount } from '@/services/api/plaza';
import { fetchUnreadFriendActivityCount } from '@/services/api/friends';
import { fetchCurrentUser } from '@/services/api/auth';
import { fetchWallet } from '@/services/api/coin';
import {
  fetchNotifications,
  fetchNotificationUnreadSummary,
} from '@/services/api/notifications';
import { useNotificationCenterStore } from '@/features/notifications/store/use-notification-center-store';
import { useNotificationSnackbarStore } from '@/features/notifications/store/use-notification-snackbar-store';
import { useCircleNotificationStore } from '@/features/discover/store/use-circle-notification-store';
import { useMomentsFeedSignalStore } from '@/features/discover/store/use-moments-feed-signal-store';
import { useCallStore } from '@/features/call/store/use-call-store';
import { clearLocalSession, registerLogoutHandler } from '@/services/auth/session';
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
import { BELL_NOTIFICATION_TYPES } from '@/features/notifications/utils/notification-domain';

type BadgeSnapshotPayload = {
  messagesUnread?: number;
  contactsUnread?: number;
  discoverUnread?: number;
  momentsUnread?: number;
  circleUnread?: number;
  signupUnread?: number;
  profileUnread?: number;
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
      // count = 互动域总数；momentsUnread/circleUnread 是后加的 per-bell 计数，
      // 老后端不带（见 handleRealtimeEvent 里的存留处理）。
      payload?: {
        count?: number;
        momentsUnread?: number;
        circleUnread?: number;
      };
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
      payload?: { balance?: number; delta?: number | null; reason?: string };
    }
  | {
      type: 'wallet.recharge.completed';
      payload?: { balance?: number; delta?: number | null; reason?: string };
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
      type: 'moments.feed.updated';
      payload?: { authorId?: string; changedAt?: string };
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
const CONNECTION_OUTAGE_REPORT_THRESHOLD = 3;

// 网关用 1008 表达三种拒绝：会话被撤销、连接数超限、10s 内没发认证帧。只有
// 「撤销」是终态 —— token 已经作废，重连多少次都会在认证后被同样踢掉。三者
// code 相同，靠 reason 区分（与后端 REVOKED_CLOSE_REASON 对齐）。
//
// ⚠️ 跨仓字符串契约（#102）：这个字面量必须与
//   circle_be/src/realtime/realtime.service.ts 的 REVOKED_CLOSE_REASON
// 逐字节一致。它是终态判定的**唯一**依据（code 1008 不够），任何一侧改词、
// 另一侧的测试都不会报警 —— 撤销登出会静默退化成重连环直到 JWT 过期（~1h）。
// 改动必须两仓同步 + 双方 pin 测试同步更新
// （本仓 test/realtime-revoked-contract.test.js）。
const REVOKED_CLOSE_CODE = 1008;
const REVOKED_CLOSE_REASON = 'Session revoked';

/**
 * 只认「明确说了是撤销」的关闭帧。RN 的 close 事件不保证带 reason，测试里也
 * 有无参调用 onclose 的用法；拿不准时一律当成普通断线去重连 —— 误重连只是多
 * 一次退避，误登出会把还有效的会话踹掉。
 */
function isRevokedClose(event: unknown): boolean {
  if (typeof event !== 'object' || event === null) {
    return false;
  }

  const { code, reason } = event as { code?: unknown; reason?: unknown };
  return code === REVOKED_CLOSE_CODE && reason === REVOKED_CLOSE_REASON;
}

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let currentToken: string | null = null;
let manualDisconnect = false;
let reconnectAttempt = 0;
// 「这条连接是断线之后重建的，恢复时要补一次」——同样按会话记而不是布尔:
// token 轮换走的是 SessionBootstrap effect 的 cleanup(disconnectRealtime)+重连,
// 布尔会在那一步被清掉,断线期间错过的钱包/通知/朋友圈就再也补不回来了。
// 换号或登出时 sessionEpoch 变了,标记自然作废,不会替新账号补拉。
let reconnectRecoveryPendingSession: number | null = null;
let reportedCurrentConnectionOutage = false;
const reportedRealtimeFailures = new Set<string>();
let walletRefreshPromise: Promise<void> | null = null;
// 「在途那一发的快照已经过时了」这件事按会话记，而不是一个会被 disconnect 清掉
// 的布尔:token 轮换会调 disconnectRealtime,但在途请求仍然允许落地(见下),脏标记
// 要是被一起清掉,那一发就会写进一个更旧的余额且没有尾随请求来纠正。换号
// (sessionEpoch 变了)时这个脏标记自然作废,不会跨账号补一次读。
let walletRefreshDirtySession: number | null = null;
// 会话身份。钱包 store 是全局的,上一个账号的响应落进去就是把别人的余额显示
// 给当前账号看,所以在途请求要按「哪一次会话发出的」来判。
//
// 用 authStore.sessionEpoch 而不是本地计数:它只在登录/登出时自增,**token
// 轮换不动**。本地计数是跟着 connectRealtime 的 token 变化走的,于是一次例行
// 的令牌刷新(同一个人、同一段会话)也会把在途的余额请求判成过期丢掉,而且不
// 补发 —— 当前契约的 wallet.balance.changed 不带绝对余额,丢了就只能等下一次
// 事件或重新进页面,余额一直是旧的。
function currentSessionEpoch(): number {
  return useAuthStore.getState().sessionEpoch;
}

// 每发出一次余额请求就 +1,latestWalletRefreshId 记住"最新的那一发"。只有它
// 允许写 store、允许清单飞格子。
//
// 为什么会有两发同时在途:token 轮换时 SessionBootstrap 会 disconnect + 重连,
// disconnectRealtime 把单飞格子清空,但在途那一发按 sessionEpoch 判并不过期
// (故意的,见上面),于是轮换后的一次 wallet.balance.changed 会再发一发。两发
// 乱序返回时,先发后到的那发拿的是更旧的快照,写进去就把新余额盖回去了;它的
// finally 还会把新一发的格子清掉,单飞也跟着失效。
let walletRefreshSequence = 0;
let latestWalletRefreshId = 0;

function invalidateWalletRefresh(): void {
  // 只放开单飞格子。脏标记不清:它描述的是「已经有一次结算发生在在途快照之后」,
  // 换 token 并不会让这件事变成假。
  walletRefreshPromise = null;
}

function refreshWalletBalanceBestEffort(): Promise<void> {
  if (walletRefreshPromise) {
    // 单飞窗口里又来一次余额变更事件:第一发的快照可能取在这次结算之前,
    // 直接把第二次 poke 丢掉的话,余额会停在旧值直到下一次事件或手动刷新。
    // 保持单飞,但记脏,落地后补一次。
    walletRefreshDirtySession = currentSessionEpoch();
    return walletRefreshPromise;
  }
  walletRefreshPromise = runWalletRefresh();
  return walletRefreshPromise;
}

function runWalletRefresh(): Promise<void> {
  const epoch = currentSessionEpoch();
  walletRefreshSequence += 1;
  const requestId = walletRefreshSequence;
  latestWalletRefreshId = requestId;
  const isStale = () =>
    epoch !== currentSessionEpoch() || requestId !== latestWalletRefreshId;
  return fetchWallet()
    .then((wallet) => {
      if (isStale()) return;
      useWalletRealtimeStore.getState().setRealtimeBalance(wallet.balance);
    })
    .catch(() => {
      if (isStale()) return;
      reportRealtimeFailureOnce('walletRefresh');
    })
    .finally(() => {
      // 会话已经换掉、或后面又发了更新的一发:这一格现在归别人所有,别把它的
      // 在途请求清掉。
      if (isStale()) return;
      walletRefreshPromise = null;
      const dirtySession = walletRefreshDirtySession;
      walletRefreshDirtySession = null;
      // 换号之后的脏标记直接丢弃,不给新账号补一次读。
      if (dirtySession !== null && dirtySession === currentSessionEpoch()) {
        void refreshWalletBalanceBestEffort();
      }
    });
}

function reportRealtimeFailureOnce(kind: string): void {
  if (reportedRealtimeFailures.has(kind)) return;
  reportedRealtimeFailures.add(kind);
  reportError(new Error(`realtime ${kind} failure`), {
    operation: 'realtime',
    kind,
  });
}

function reportRealtimeConnectionOutage(): void {
  if (
    reconnectAttempt < CONNECTION_OUTAGE_REPORT_THRESHOLD ||
    reportedCurrentConnectionOutage
  ) {
    return;
  }
  reportedCurrentConnectionOutage = true;
  reportError(new Error('realtime connection failed repeatedly'), {
    operation: 'realtime',
    kind: 'consecutiveConnectionFailures',
    attempts: reconnectAttempt,
  });
}

// 断线空窗里错过的东西在「认证真的通过」之后补一次。
//
// 挂在 onopen 上是不行的:网关接受握手之后仍然可能以 1008 拒掉认证(会话撤销 /
// 连接数超限),那时 onopen 已经把 recovery 消费掉了 —— 补拉在实时通道根本没恢复
// 的情况下照常发出,而每一轮退避都会再来一次,一次网关故障会被放大成所有客户端
// 的轮询。收到第一帧才代表认证过了,补拉只在那时跑。
function runPostAuthenticationRecovery(): void {
  // 只认同一段会话里记下的断线:换号之后不替新账号补拉上一个账号错过的东西。
  const shouldForceRecovery =
    reconnectRecoveryPendingSession !== null &&
    reconnectRecoveryPendingSession === currentSessionEpoch();
  reconnectRecoveryPendingSession = null;
  // 认证成功后网关会立刻回推一帧 badge.snapshot；这里再补一次 HTTP
  // recovery，把断线期间错过的 notification.created 列表项拉回来。
  void recoverTabBadgeSnapshot({ force: shouldForceRecovery });
  if (!shouldForceRecovery) return;
  // review P2：断线重连的空窗里错过的 moments.feed.updated 补不回来 ——
  // 重连成功后 bump 一次信号，让 feed 组件自查新帖数（app 全程前台、
  // 无 AppState 变化的场景就靠这条兜住）。
  useMomentsFeedSignalStore.getState().bump();
  // 断线空窗里结算的奖励/充值,那一帧是彻底丢掉的 —— badge 和朋友圈都在这里补,
  // 钱包不补的话,一个全程挂着的钱包页会一直显示断线前的余额。走同一个单飞入口,
  // 与并发的事件驱动刷新自然合并。
  void refreshWalletBalanceBestEffort();
}

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
  reportRealtimeConnectionOutage();
  // 断线的那一刻就记账,而不是等退避回调跑起来:回到前台会直接调 connectRealtime,
  // 令牌轮换会先 disconnectRealtime 再重连 —— 两条路都会让退避回调根本不执行,
  // 标记留在回调里的话,这些路径就完全跳过了断线期间的补拉。
  reconnectRecoveryPendingSession = currentSessionEpoch();

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    const token = currentToken;
    if (!token) {
      return;
    }

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
    momentsUnread: snapshot.momentsUnread,
    circleUnread: snapshot.circleUnread,
    signupUnread: snapshot.signupUnread,
    profileUnread: snapshot.profileUnread,
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

function handleNotificationCreated(payload: NotificationItem) {
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
      if (!isNotificationItem(message.payload)) {
        reportRealtimeFailureOnce('malformedPayload');
        return;
      }
      handleNotificationCreated(message.payload);
      return;
    case 'friend.activity.unread.changed':
      badgeStore.setContactsUnread(message.payload?.count ?? 0);
      return;
    case 'interaction.unread.changed':
      badgeStore.setDiscoverUnread(message.payload?.count ?? 0);
      // 两个铃铛各读一个 per-domain 计数。老后端不带这两个字段：留住既有值，
      // 而不是清零 —— 否则每来一条互动通知，另一个铃铛的红点就被抹掉。
      if (typeof message.payload?.momentsUnread === 'number') {
        badgeStore.setMomentsUnread(message.payload.momentsUnread);
      }
      if (typeof message.payload?.circleUnread === 'number') {
        badgeStore.setCircleUnread(message.payload.circleUnread);
      }
      return;
    case 'circle.signup.unread.changed':
      badgeStore.setSignupUnread(message.payload?.count ?? 0);
      return;
    case 'membership.status.changed':
      refreshCurrentUserSummaryBestEffort();
      return;
    case 'wallet.balance.changed':
      // 新旧后端兼容：旧事件可能带绝对 balance；当前权威契约只带 delta/reason，
      // 收到 poke 后去 REST 拉余额。单飞避免批量奖励/购买事件形成请求风暴。
      if (typeof message.payload?.balance === 'number') {
        useWalletRealtimeStore.getState().setRealtimeBalance(message.payload.balance);
      } else {
        void refreshWalletBalanceBestEffort();
      }
      return;
    case 'wallet.recharge.completed':
      if (typeof message.payload?.balance === 'number') {
        useWalletRealtimeStore.getState().setRealtimeBalance(message.payload.balance);
      } else {
        void refreshWalletBalanceBestEffort();
      }
      return;
    case 'system.notification.unread.changed':
      badgeStore.setProfileUnread(message.payload?.count ?? 0);
      return;
    case 'user.profile.summary.changed':
      refreshCurrentUserSummaryBestEffort();
      return;
    // 下面三个事件后端都在真实路径上发，这里「有意不处理」而不是「已处理」（#104）：
    // 每个都与一个客户端已消费的事件同批到达（interaction-unread / notification.created），
    // 徽标与通知列表不受影响。丢掉的是增强 payload —— traceId/commentId 可深链到评论、
    // invitationId+status 可原地更新邀请页。要做时请对着 #104 的清单接。
    case 'circle.post.interaction.created':
      return;
    case 'circle.invitation.reviewed':
      return;
    case 'system.notification.created':
      return;
    case 'moments.feed.updated':
      // 轻量 poke（#89）：不带内容，只表示「你的朋友圈 feed 变了」。bump 后由
      // feed 组件自行决定拉不拉（权限判定始终在 GET /trace/feed 服务端）。
      useMomentsFeedSignalStore.getState().bump();
      return;
    case 'call.invite':
      if (!isCallInvitePayload(message.payload)) {
        reportRealtimeFailureOnce('malformedPayload');
        return;
      }
      callStore.handleCallInvite(message.payload);
      return;
    case 'call.participant.joined':
      if (!isCallParticipantPayload(message.payload)) {
        reportRealtimeFailureOnce('malformedPayload');
        return;
      }
      callStore.handleCallParticipantJoined(message.payload);
      return;
    case 'call.participant.left':
      if (!isCallParticipantPayload(message.payload)) {
        reportRealtimeFailureOnce('malformedPayload');
        return;
      }
      callStore.handleCallParticipantLeft(message.payload);
      return;
    case 'call.participant.rejected':
      if (!isCallParticipantPayload(message.payload)) {
        reportRealtimeFailureOnce('malformedPayload');
        return;
      }
      callStore.handleCallParticipantRejected(message.payload);
      return;
    case 'call.participant.missed':
      if (!isCallParticipantPayload(message.payload)) {
        reportRealtimeFailureOnce('malformedPayload');
        return;
      }
      callStore.handleCallParticipantMissed(message.payload);
      return;
    case 'call.ended':
    case 'call.canceled':
      if (!isCallStatePayload(message.payload)) {
        reportRealtimeFailureOnce('malformedPayload');
        return;
      }
      callStore.handleCallEnded(message.payload);
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
    reportRealtimeFailureOnce('malformedPayload');
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
      momentsUnread: notificationSummary.momentsUnread,
      circleUnread: notificationSummary.circleUnread,
      signupUnread,
      profileUnread: notificationSummary.profileUnread,
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

  // 这条连接是否已经收到过帧 = 认证是否真的通过。补拉全部挂在它后面。
  let authenticatedOnThisSocket = false;

  nextSocket.onopen = () => {
    // 退避不在这里归零：握手成功只说明 WS 通了，认证还没发生。网关可能紧接着
    // 以 1008 踢掉（会话撤销 / 连接数超限），那时归零会让退避永远停在第一档，
    // 退化成每秒锤一次后端。归零挪到 onmessage —— 收到帧才代表认证真的过了。
    // 必须先发认证帧，否则网关 10s 后以 1008 踢掉连接，且期间收不到任何事件。
    try {
      nextSocket.send(JSON.stringify({ type: 'auth', token: normalizedToken }));
    } catch (err) {
      reportRealtimeFailureOnce('authFrameSend');
      useTabBadgeStore.getState().setRealtimeConnected(false);
      nextSocket.close();
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[realtime] failed to send auth frame', err);
      }
      return;
    }
    useTabBadgeStore.getState().setRealtimeConnected(true);
  };

  nextSocket.onmessage = (event) => {
    if (typeof event.data !== 'string') {
      return;
    }

    // 未认证的连接拿不到任何一帧，所以收到帧 = 认证已通过 = 这条连接真的可用。
    // 这是退避唯一的归零点（显式 connectRealtime 除外）。
    reconnectAttempt = 0;
    reportedCurrentConnectionOutage = false;
    if (!authenticatedOnThisSocket) {
      authenticatedOnThisSocket = true;
      runPostAuthenticationRecovery();
    }
    handleSocketMessage(event.data);
  };

  nextSocket.onerror = () => {
    useTabBadgeStore.getState().setRealtimeConnected(false);
  };

  nextSocket.onclose = (event: unknown) => {
    if (socket === nextSocket) {
      socket = null;
    }

    useTabBadgeStore.getState().setRealtimeConnected(false);

    if (manualDisconnect) {
      return;
    }

    // 会话被撤销时重连是有害的：服务端已经作废这个 token，每次重连都会在认证
    // 后被立刻踢回来，而用户毫无察觉（红点与来电静默消失，直到 token 自然过期）。
    // 走和 HTTP 401 相同的出口，把用户送回登录页。
    if (isRevokedClose(event)) {
      currentToken = null;
      void clearLocalSession();
      return;
    }

    scheduleReconnect();
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
  reportedCurrentConnectionOutage = false;
  clearReconnectTimer();
  openRealtimeSocket(normalizedToken);
}

export function disconnectRealtime() {
  manualDisconnect = true;
  currentToken = null;
  // 断线标记不在这里清:token 轮换同样走 disconnectRealtime + 重连,清掉就等于
  // 把断线期间错过的补拉一起丢了。它按会话记,登出/换号会让它自然失效。
  reportedRealtimeFailures.clear();
  invalidateWalletRefresh();
  clearReconnectTimer();
  useTabBadgeStore.getState().setRealtimeConnected(false);
  closeSocket();
}

// 注册到 session 的登出 teardown，避免 session.ts 反向 import 实时通道。
registerLogoutHandler(disconnectRealtime);
