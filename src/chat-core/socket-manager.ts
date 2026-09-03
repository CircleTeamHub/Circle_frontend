import { io, type Socket } from 'socket.io-client';
import { Platform } from 'react-native';
import { CHAT_WS_URL } from '@/constants/config';
import { storage } from '@/storage';
import { reportError } from '@/observability/sentry';
import { fetchPrivacySettings } from '@/services/api/privacy';
import { logClientDiagnostic } from '@/utils/client-diagnostics';
import {
  backfillConversationSince,
  fetchChatMutationsSince,
  loadChatConversations,
  loadChatHistory,
} from './api';
import {
  dropAllLocalMessages,
  initChatLocalDb,
  outboxDelete,
  outboxList,
  pendingReadDelete,
  pendingReadUpsert,
  pendingReadsList,
  readLocalConversations,
  readRecentLocalMessages,
  upsertLocalConversation,
} from './local-db';
import { initChatAppBadgeSync } from './app-badge';
import { bindChatEvents, cancelConversationBackfill } from './dispatcher';
import {
  CHAT_EVENTS,
  CHAT_WS_PATH,
  SERVER_COMPENSATED_TYPES,
  type ChatConversationDto,
  type ChatReadAck,
  type ChatSendAck,
  type ChatSendAckOk,
  type ChatSendPayload,
} from './protocol';
import {
  sanitizeExpiredConversationPreviews,
  useChatStore,
  viewerSelfDestructDaysStorageKey,
} from './store';

/**
 * 自研聊天 socket 管理器（squady SocketManager 的 TS 移植，按本仓
 * realtime/client.ts 的模块函数风格组织）。
 *
 * 可靠性契约：
 * - 发送走 ack + 超时；超时/失败由调用方用同一 d 重发，服务端幂等兜底。
 * - 已读水位进 pending 队列，断线重连后自动 flush（squady 同款）。
 * - 登出竞态用 session generation 防护：断开后到达的异步结果一律丢弃。
 */

const SEND_ACK_TIMEOUT_MS = 10_000;
const READ_ACK_TIMEOUT_MS = 8_000;
const TYPING_THROTTLE_MS = 2_000;
/** 一次追平最多翻几页离线变更;翻不完留给下一次连接(游标已持久化)。 */
const MUTATION_CATCH_UP_PAGES_MAX = 20;

type ChatConnectFailureReason =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'timeout'
  | 'server_error'
  | 'transport_error'
  | 'network_error'
  | 'unknown';

type ChatDisconnectReason =
  | 'server_disconnect'
  | 'client_disconnect'
  | 'timeout'
  | 'transport_error'
  | 'unknown';

function createConnectionTraceId(): string {
  const random = `${Math.random().toString(36).slice(2, 10)}${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  return `ws-${Date.now().toString(36)}-${random}`;
}

function readConnectErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const source = error as Record<string, unknown>;
  const candidates = [source.status, source.statusCode];
  for (const nested of [source.description, source.context, source.data]) {
    if (nested && typeof nested === 'object') {
      const record = nested as Record<string, unknown>;
      candidates.push(record.status, record.statusCode);
    }
  }
  return candidates.find(
    (candidate): candidate is number =>
      typeof candidate === 'number' && candidate >= 100 && candidate <= 599,
  );
}

function classifyConnectFailure(error: unknown): ChatConnectFailureReason {
  const status = readConnectErrorStatus(error);
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status !== undefined && status >= 500) return 'server_error';

  const source =
    error && typeof error === 'object'
      ? (error as Record<string, unknown>)
      : undefined;
  const text = [source?.name, source?.type, source?.message]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  if (/unauthori[sz]ed|authentication|\bjwt\b/.test(text)) {
    return 'unauthorized';
  }
  if (/forbidden|origin/.test(text)) return 'forbidden';
  if (/not[ _-]?found|\b404\b/.test(text)) return 'not_found';
  if (/rate[ _-]?limit|\b429\b/.test(text)) return 'rate_limited';
  if (/timeout|timed out/.test(text)) return 'timeout';
  if (/server error|\b5\d\d\b/.test(text)) return 'server_error';
  if (/websocket|transport/.test(text)) return 'transport_error';
  if (/network|offline|internet/.test(text)) return 'network_error';
  return 'unknown';
}

function classifyDisconnectReason(reason: unknown): ChatDisconnectReason {
  if (reason === 'io server disconnect') return 'server_disconnect';
  if (reason === 'io client disconnect') return 'client_disconnect';
  if (reason === 'ping timeout') return 'timeout';
  if (reason === 'transport close' || reason === 'transport error') {
    return 'transport_error';
  }
  return 'unknown';
}

function readViewerSelfDestructDays(userId: string): number {
  try {
    const value = Number(
      storage.getString(viewerSelfDestructDaysStorageKey(userId)) ?? '0',
    );
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

let viewerPolicyRefreshGeneration = 0;

async function refreshViewerSelfDestructDays(userId: string): Promise<void> {
  const request = ++viewerPolicyRefreshGeneration;
  const revision = useChatStore.getState().viewerSelfDestructPolicyRevision;
  try {
    const settings = await fetchPrivacySettings();
    const store = useChatStore.getState();
    if (
      request !== viewerPolicyRefreshGeneration ||
      store.currentUserId !== userId ||
      store.viewerSelfDestructPolicyRevision !== revision
    ) {
      return;
    }
    store.setViewerSelfDestructDays(settings.messageSelfDestructDays, {
      remoteRefresh: true,
    });
  } catch {
    // 离线时沿用按账号缓存的最后已知策略，不能让策略刷新阻断聊天连接。
  }
}

async function hydrateWithResolvedViewerPolicy(
  userId: string,
  generation: number,
): Promise<void> {
  // 先摘掉上一账号的句柄并开始开新库；隐私策略只阻塞快照发布，不能让旧库在
  // 慢 REST 请求期间继续服务新账号的 local-first 读写。
  const localDbReady = initChatLocalDb(userId);
  await refreshViewerSelfDestructDays(userId);
  if (
    generation !== sessionGen ||
    useChatStore.getState().currentUserId !== userId
  ) {
    return;
  }
  const opened = await localDbReady;
  if (
    !opened ||
    generation !== sessionGen ||
    useChatStore.getState().currentUserId !== userId
  ) {
    return;
  }
  await hydrateFromLocalDb(userId, generation, true);
}

let socket: Socket | null = null;
let sessionGen = 0;
/**
 * 本账号在本次进程里是否已经连上过一次(跨 socket 实例的重连判据)。
 * 登出/换账号时清掉 —— 新账号的第一次连接是首连,不该触发对账。
 */
let hadConnectedForUser: string | null = null;
/**
 * 上一次成功追平「离线撤回/编辑」增量的服务端时刻(ISO)。
 *
 * 落 MMKV 而不是只放内存:App 被杀之后本地库里那些消息还在,而这期间发生的
 * 撤回同样够不着(撤回不改 height)。持久化之后,下次冷启动第一次连上就能
 * 从上次的游标追平。
 */
const MUTATION_CURSOR_KEY = 'chat.mutationCursor';
let lastMutationSyncAt: string | null = null;

function mutationCursorKey(userId: string): string {
  return `${MUTATION_CURSOR_KEY}.${userId}`;
}

function readMutationCursor(userId: string): string | null {
  try {
    return storage.getString(mutationCursorKey(userId)) ?? null;
  } catch {
    return null;
  }
}

function writeMutationCursor(userId: string, iso: string): void {
  lastMutationSyncAt = iso;
  try {
    storage.set(mutationCursorKey(userId), iso);
  } catch {
    // MMKV 还没就绪:内存里那份仍然有效,只是重启后从头再来。
  }
}
const pendingReads = new Map<string, number>();
let flushingReads = false;
let readFlushRequested = false;
const typingSentAt = new Map<string, number>();
let consecutiveConnectErrors = 0;
let reportedCurrentConnectOutage = false;

/** ack {ok:false} 的类型化错误：code = circle_be ChatErrorCode 字符串码。 */
export class ChatSendError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = 'ChatSendError';
    this.code = code;
  }
}

/** 客户端幂等键：每条消息一个，重发复用同一个。 */
export function createDeliveryId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `d-${Date.now().toString(36)}-${random}`;
}

export function connectChat(token: string, userId: string): void {
  const store = useChatStore.getState();
  // 已连着、而且连的就是这个人:no-op(回前台补连、token 轮换都走这条)。
  // 身份不同必须重连:冷启动时磁盘上的 user 快照可能缺失或属于上一个账号,
  // 用它连上之后 /auth/me 才把权威用户写回来。只看 connected 的话那条错身份
  // 的连接会一直留着 —— 收发方向按错的 currentUserId 判,自己发的消息被算成
  // 收到的,未读也跟着错,直到真的断线重连或重启才恢复。
  if (socket?.connected && store.currentUserId === userId) {
    void store.purgeExpiredBurnMessages();
    return;
  }
  // 换账号才清 store。放在这里而不是调用方,是为了让「挂起 → 重连」这条
  // 路径天然安全:同一账号轮换 token 时列表/消息/pending 已读原样保留,
  // 而切到另一个账号时上一个账号的数据一定先被清掉(跨账号不串数据)。
  if (store.currentUserId !== null && store.currentUserId !== userId) {
    store.reset();
    pendingReads.clear();
    flushingReads = false;
    readFlushRequested = false;
    hadConnectedForUser = null;
    lastMutationSyncAt = null;
    // 换账号是真正的会话边界:新账号的第一次连不上,值得单独报一次。
    reportedCurrentConnectOutage = false;
  }
  teardownSocket();
  sessionGen += 1;
  const gen = sessionGen;
  consecutiveConnectErrors = 0;
  // 这里**不能**重置 reportedCurrentConnectOutage。设备一直离线时,回前台恢复
  // (SessionBootstrap 每次 active 都会 connectChat)和 token 轮换都会走到这里替换
  // 掉那个连不上的 socket;在这里清标志,等于每回一次前台就让下一条 connect_error
  // 重新上报一次。一次长断网被前后台切几十次,就是几十条同样的 Sentry 事件,
  // 「一次断网只报一条」的抑制就形同虚设了。只有真正连上(connect 回调)或换账号
  // 才算这次断网结束。
  const connectionTraceId = createConnectionTraceId();
  store.setConnecting(true);
  store.setCurrentUserId(userId);
  store.setViewerSelfDestructDays(readViewerSelfDestructDays(userId));
  initChatAppBadgeSync();
  // 在线时先解析服务器策略，失败才使用上面的账户缓存，避免冷启动展示已到期内容。
  void hydrateWithResolvedViewerPolicy(userId, gen);

  // token 走握手 auth 帧，绝不进 URL query（与 realtime 网关同一条安全线）。
  logClientDiagnostic('chat.ws.connecting', {
    stage: 'handshake',
    platform: Platform.OS,
  });
  const next = io(CHAT_WS_URL, {
    path: CHAT_WS_PATH,
    transports: ['websocket'],
    auth: { token, traceId: connectionTraceId },
    // React Native WebSocket 会把该头带到 HTTP upgrade，供 Caddy 与网关日志
    // 串联；auth 里的副本覆盖不支持自定义头的 web 运行时。
    extraHeaders: { 'x-connection-trace-id': connectionTraceId },
  });

  next.on('connect', () => {
    if (gen !== sessionGen) return;
    consecutiveConnectErrors = 0;
    reportedCurrentConnectOutage = false;
    logClientDiagnostic('chat.ws.connected', {
      stage: 'ready',
      platform: Platform.OS,
    });
    // 首连不对账(冷启动全量拉取由页面 focus 负责),重连才补断线窗口。
    // 判据必须跨 socket 实例:access token 轮换走的是 suspendChat + connectChat,
    // 换的是**一条新 socket**。判据挂在 socket 上的话,这条新连接永远算首连,
    // 断开到重连之间的消息一条都不补 —— 而已经打开的会话不会重拉历史,
    // 于是那段消息在屏幕上凭空缺失,未读也停在轮换前。
    const isReconnect = hadConnectedForUser === userId;
    hadConnectedForUser = userId;
    const state = useChatStore.getState();
    state.setConnecting(false);
    state.setConnected(true);
    state.setError(null);
    if (isReconnect) void refreshViewerSelfDestructDays(userId);
    void flushPendingReads();
    if (isReconnect) {
      resyncAfterReconnect(userId);
      return;
    }
    // 首连不做全量对账(冷启动拉取由页面 focus 负责),但撤回/编辑增量必须追:
    // 上次运行到这次启动之间发生的撤回,本地缓存里还是原文,而 height 没变,
    // 任何补拉都够不着它。
    void catchUpMutations(userId);
  });
  next.on('disconnect', (reason) => {
    if (gen !== sessionGen) return;
    logClientDiagnostic('chat.ws.disconnected', {
      stage: 'ready',
      reason: classifyDisconnectReason(reason),
      platform: Platform.OS,
    });
    useChatStore.getState().setConnected(false);
  });
  next.on('connect_error', (err) => {
    if (gen !== sessionGen) return;
    console.warn('[chat] connect error', err?.message ?? err);
    consecutiveConnectErrors += 1;
    const reason = classifyConnectFailure(err);
    logClientDiagnostic('chat.ws.connect_error', {
      stage: 'handshake',
      reason,
      platform: Platform.OS,
    });
    if (!reportedCurrentConnectOutage) {
      reportedCurrentConnectOutage = true;
      reportError(new Error('chat connection failed'), {
        operation: 'chatConnect',
        kind: reason,
        failureKind: 'connect_error',
        attempts: consecutiveConnectErrors,
        stage: 'handshake',
        reason,
        source: 'websocket',
        endpointPath: CHAT_WS_PATH,
        platform: Platform.OS,
        traceId: connectionTraceId,
      });
    }
    const state = useChatStore.getState();
    state.setConnecting(false);
    // 只放规范化标记进 store —— err.message 是 socket.io 的底层文本
    // ("websocket error"/"timeout"),会被 UI 原样展示给用户。原始原因
    // 上面的本地诊断与一次/故障窗口的 Sentry 事件已经留档。
    state.setError('connect_error');
  });

  bindChatEvents(next, () => gen === sessionGen);
  socket = next;
}

/**
 * 登出语义:断连 + 清空 store(含 currentUserId)。
 * 只在真的没有会话时用 —— 见 suspendChat 的说明。
 */
export function disconnectChat(): void {
  suspendChat();
  // 只有真登出/换账号才丢待发已读:那些水位属于上一个会话身份。
  pendingReads.clear();
  hadConnectedForUser = null;
  // 游标只清内存那份:MMKV 里按 userId 存,下次同一账号登录还要用它追平
  // 「上次退出之后发生的撤回」。
  lastMutationSyncAt = null;
  useChatStore.getState().reset();
}

/**
 * 挂起语义:断连但保留 store。
 *
 * access token 轮换会让 session-bootstrap 的 effect 重跑,cleanup 若走
 * disconnectChat 就会连带清掉全部会话/消息/未读/待发已读 —— 正在看的
 * ChatDetailScreen 的历史加载 effect 不依赖 token,不会重拉,于是屏幕
 * 空到用户手动退出重进为止,pending 已读也一并丢了。
 * 重连由 connectChat 负责,它自己会在换账号时清 store。
 */
export function suspendChat(): void {
  sessionGen += 1;
  cancelConversationBackfill();
  // 刻意不清 pendingReads:token 轮换会走这条路,清掉的话那些还没拿到 ack 的
  // 已读水位就永远发不出去了 —— 服务端那边消息一直是未读,直到会话又有新消息
  // 或用户重新进一次。挂起的语义是「连接没了」,不是「这些事没发生过」。
  typingSentAt.clear();
  deliveredReportedAt.clear();
  deliveredPending.clear();
  for (const timer of deliveredTimers.values()) clearTimeout(timer);
  deliveredTimers.clear();
  flushingReads = false;
  readFlushRequested = false;
  teardownSocket();
  useChatStore.getState().setConnected(false);
  useChatStore.getState().setConnecting(false);
}

function teardownSocket(): void {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}

/**
 * G-01:本地库水合。会话列表 + 各会话最近消息灌回内存(仅空结构生效,
 * 不覆盖已到手的服务端数据);outbox 里的失败消息还原成失败态乐观气泡;
 * 未上报的已读水位种回 pending 队列。全程尽力而为。
 */
function effectiveSelfDestructSeconds(
  conversation: ChatConversationDto | undefined,
  viewerSelfDestructDays: number,
): number | null {
  const viewerSeconds =
    viewerSelfDestructDays > 0
      ? viewerSelfDestructDays * 24 * 60 * 60
      : null;
  const conversationSeconds =
    conversation?.burnDurationSec && conversation.burnDurationSec > 0
      ? conversation.burnDurationSec
      : null;
  return conversationSeconds && viewerSeconds
    ? Math.min(conversationSeconds, viewerSeconds)
    : (conversationSeconds ?? viewerSeconds);
}

async function hydrateFromLocalDb(
  userId: string,
  generation: number,
  databaseReady = false,
): Promise<void> {
  const isCurrentSession = (): boolean =>
    generation === sessionGen &&
    useChatStore.getState().currentUserId === userId;
  try {
    const opened = databaseReady || (await initChatLocalDb(userId));
    if (!opened || !isCurrentSession()) return;
    const persistedConversations = await readLocalConversations();
    if (!isCurrentSession()) return;
    const conversations = sanitizeExpiredConversationPreviews(
      persistedConversations,
      useChatStore.getState().viewerSelfDestructDays,
    );
    for (let index = 0; index < conversations.length; index += 1) {
      if (conversations[index] !== persistedConversations[index]) {
        void upsertLocalConversation(conversations[index]);
      }
    }
    // 会话列表先出。逐会话串行读时间线是几百次原生查询,放在 hydrate 之前的话
    // 离线用户得盯着空列表等它跑完 —— 而列表本身早就在手上了。
    if (!isCurrentSession()) return;
    useChatStore.getState().hydrateLocalSnapshot(conversations, {});
    const timelines: Record<string, import('./protocol').ChatMessageDto[]> = {};
    for (const conversation of conversations) {
      if (!isCurrentSession()) return;
      timelines[conversation.id] = await readRecentLocalMessages(
        conversation.id,
        50,
      );
      if (!isCurrentSession()) return;
    }
    if (!isCurrentSession()) return;
    useChatStore.getState().hydrateLocalSnapshot(conversations, timelines);
    // 等待 SQLite/FTS/outbox 的到期删除真正落盘，不能让后面的 outbox 水合把
    // 已过期的失败发送重新插回时间线。
    await useChatStore.getState().purgeExpiredBurnMessages();
    if (!isCurrentSession()) return;
    // outbox:上次没发出去的消息还原成「发送失败」气泡,可长按重发。
    const pending = await outboxList();
    if (!isCurrentSession()) return;
    // purge 或 outbox 读取期间服务端快照/设置页都可能收紧策略；兜底必须使用
    // 异步读取完成后的当前策略，不能回退到刚从 SQLite 读出的旧会话策略。
    const policyState = useChatStore.getState();
    const conversationsById = new Map(
      policyState.conversations.map((conversation) => [
        conversation.id,
        conversation,
      ]),
    );
    const viewerSelfDestructDays = policyState.viewerSelfDestructDays;
    const outboxCutoffNow = Date.now();
    for (const entry of pending) {
      const selfDestructSeconds = effectiveSelfDestructSeconds(
        conversationsById.get(entry.conversationId),
        viewerSelfDestructDays,
      );
      const createdAt = Date.parse(entry.createdAt);
      // SQLite 删除失败会被本地缓存层降级吞掉；水合入口仍须执行同一策略，不能把
      // 尚未删掉的私密正文重新插回时间线。删除会在后续周期 sweep 中继续重试。
      if (
        selfDestructSeconds &&
        Number.isFinite(createdAt) &&
        createdAt < outboxCutoffNow - selfDestructSeconds * 1000
      ) {
        void outboxDelete(entry.d);
        continue;
      }
      // 先认账:本地时间线里已经有同 d 的**已确认**消息(height>0),说明这条
      // 其实发出去了,只是当初出队那一下没落盘。不拦住的话 mergeMessages 按 d
      // 去重会把那条已确认的删掉、换上下面这个 height=0 的占位,再被
      // markMessageFailed 标红 —— 一条真发出去的消息每次冷启动都显示
      // 「发送失败」,点进会话拉到真历史才好,退出来又坏(用户可复现)。
      // 顺手把这行出队:它已经是脏数据,留着每次启动都要再演一遍。
      const alreadyDelivered = (timelines[entry.conversationId] ?? []).some(
        (message) => message.d === entry.d && message.height > 0,
      );
      // 服务端补发的类型(转账卡片)压根不该在队列里:后端那张卡用的是
      // `gift_card_<id>`,和这里的 d 不是一个键,上面的同 d 判据永远匹配不上,
      // 于是这条失败气泡会永远赖在时间线最底下。新版发送侧已经不再入队,
      // 这一行负责把旧版留下的脏数据清掉。
      if (alreadyDelivered || SERVER_COMPENSATED_TYPES.has(entry.payload.type)) {
        void outboxDelete(entry.d);
        continue;
      }
      const optimistic = {
        id: `outbox-${entry.d}`,
        conversationId: entry.conversationId,
        height: 0,
        type: entry.payload.type,
        content: entry.payload.content,
        // sender 必须是本人。留 null 的话 mapChatMessageDtoToUI 判成「收到的」,
        // 气泡渲染到左边、也拿不到失败态 —— 长按重发那条依赖 sendStatus=3 的
        // 菜单项因此不出现,这条消息就再也发不出去了。
        sender: { id: userId, nickname: '', avatarUrl: null },
        replyToId: entry.payload.replyToId ?? null,
        d: entry.d,
        createdAt: entry.createdAt,
      };
      useChatStore
        .getState()
        .ingestMessages(entry.conversationId, [optimistic]);
      useChatStore.getState().markMessageFailed(entry.conversationId, entry.d);
    }
    // 已读水位:App 被杀前没 ack 的上报补回队列,连上即 flush。
    let restored = false;
    const persistedReads = await pendingReadsList();
    if (!isCurrentSession()) return;
    for (const { conversationId, height } of persistedReads) {
      const prior = pendingReads.get(conversationId) ?? 0;
      if (height > prior) {
        pendingReads.set(conversationId, height);
        restored = true;
      }
    }
    // 冷启动时 socket 可能已经先连上了 —— 那次 connect 钩子 flush 的是一个空
    // 队列。种回来之后不再 flush 的话,这些水位要等到用户又读了一条消息或者
    // 下一次重连才发得出去,服务端那边一直是未读。
    if (restored) void flushPendingReads();
  } catch (err) {
    console.warn('[chat] local hydrate failed', err);
  }
}

/**
 * 撤回/编辑不改 height,afterHeight 补拉结构上永远够不着:断线(或被杀)期间
 * 被撤回的消息在本地会一直显示原文。按时间轴单独追一遍,一直追到服务端说
 * 没有更多为止 —— 单页有上限,只拉一页会把剩下的永久跳过。
 *
 * 没有游标 = 这台设备上还没有任何本地历史可言(首次登录),没什么要追的,
 * 只把游标种在「现在」。有游标就必须追,哪怕这是本次进程的第一次连接:
 * 上一次运行结束到现在之间发生的撤回,只有这条路径看得见。
 */
async function catchUpMutations(userId: string): Promise<void> {
  const stored = lastMutationSyncAt ?? readMutationCursor(userId);
  if (!stored) {
    writeMutationCursor(userId, new Date().toISOString());
    return;
  }
  let since = stored;
  let sinceId = '';
  try {
    for (let page = 0; page < MUTATION_CATCH_UP_PAGES_MAX; page += 1) {
      const result = await fetchChatMutationsSince(since, sinceId);
      if (!result) return; // 会话已换人/已登出
      if (result.resetRequired) {
        // 游标比服务端的保留窗口还老:那段区间的撤回它已经查不到了。
        // 本地缓存里那些消息会永远显示原文(撤回不改 height,补拉够不着),
        // 唯一安全的做法是整体作废、重新从服务端拉。
        await resetLocalMessageCache();
        writeMutationCursor(userId, result.serverTime);
        return;
      }
      writeMutationCursor(userId, result.nextSince);
      if (!result.hasMore) return;
      // 游标不前进就是原地打转,继续追只会死循环。
      if (result.nextSince === since && result.nextSinceId === sinceId) return;
      since = result.nextSince;
      sinceId = result.nextSinceId;
    }
  } catch (err) {
    console.warn('[chat] mutation catch-up failed', err);
  }
}

/** 丢掉全部缓存消息(会话行留着,列表不至于空掉),下次进屏幕重新拉。 */
async function resetLocalMessageCache(): Promise<void> {
  console.warn('[chat] mutation cursor expired; dropping cached messages');
  useChatStore.getState().dropCachedMessages();
  await dropAllLocalMessages().catch(() => undefined);
}

/**
 * G-13 断线重连对账:断开期间的 chat:msg 不会重投,必须主动补,否则那段
 * 消息在已打开的会话里永远不出现、列表未读也停在断线前。
 * ① 重拉会话列表(未读/预览/新会话一次到位,服务端为准);
 * ② 当前打开的会话按本地最高 height 升序追平(与广播同一 ingest 入口,幂等)。
 * 其余会话不逐个补:进入时的历史加载与列表快照已覆盖。
 */
function resyncAfterReconnect(userId: string): void {
  void loadChatConversations().catch((err: unknown) =>
    console.warn('[chat] reconnect conversation refresh failed', err),
  );
  void catchUpMutations(userId);
  const state = useChatStore.getState();
  const active = state.activeConversationId;
  if (!active) return;
  let maxHeight = 0;
  for (const message of state.messagesByConversation[active] ?? []) {
    if (message.height > maxHeight) maxHeight = message.height;
  }
  if (maxHeight <= 0) {
    // 打开会话时正好断网、首屏 REST 也失败 → 时间线一条确认消息都没有。
    // 直接 return 的话这条唯一的恢复路径也放弃了,而屏幕上的历史加载 effect
    // 不随连通性重跑:会话就这么一直空着,直到用户退出重进。
    void loadChatHistory(active).catch((err: unknown) =>
      console.warn('[chat] reconnect initial history failed', err),
    );
    return;
  }
  void backfillConversationSince(active, maxHeight).catch((err: unknown) =>
    console.warn('[chat] reconnect gap backfill failed', err),
  );
}

export function isChatConnected(): boolean {
  return socket?.connected === true;
}

/**
 * 发消息：ack 返回即已持久化。超时/失败时调用方保留同一 d 重试，
 * 服务端 (conversationId, sender, d) 唯一约束保证不重复入库。
 */
export function sendChatMessage(input: ChatSendPayload): Promise<ChatSendAckOk> {
  const current = socket;
  if (!current?.connected) {
    return Promise.reject(new ChatSendError('CHAT_NOT_CONNECTED', 'socket 未连接'));
  }
  return new Promise<ChatSendAckOk>((resolve, reject) => {
    current
      .timeout(SEND_ACK_TIMEOUT_MS)
      .emit(CHAT_EVENTS.send, input, (err: Error | null, ack: ChatSendAck) => {
        if (err) {
          reject(new ChatSendError('CHAT_ACK_TIMEOUT', err.message));
          return;
        }
        if (!ack || ack.ok !== true) {
          reject(
            new ChatSendError(
              ack?.code ?? 'CHAT_INVALID_PAYLOAD',
              ack && 'message' in ack ? ack.message : undefined,
            ),
          );
          return;
        }
        resolve(ack);
      });
  });
}

/** 已读上报：本地水位合并（只增不减），连接可用时逐条 flush 带 ack。 */
export function markChatRead(conversationId: string, height: number): void {
  if (!Number.isInteger(height) || height <= 0) return;
  const prior = pendingReads.get(conversationId) ?? 0;
  if (height > prior) {
    pendingReads.set(conversationId, height);
    // G-01:落盘,App 被杀也不丢(flush 成功后删除)。
    void pendingReadUpsert(conversationId, height);
  }
  void flushPendingReads();
}

async function flushPendingReads(): Promise<void> {
  if (flushingReads) {
    // flush 进行中又有新水位入队:标记之,当前轮结束后立刻补一轮
    // (squady _pendingReadFlushRequested 同款;缺了它,新水位会滞留到下次重连)。
    readFlushRequested = true;
    return;
  }
  const current = socket;
  if (!current?.connected) return;
  flushingReads = true;
  readFlushRequested = false;
  const gen = sessionGen;
  try {
    for (const [conversationId, height] of [...pendingReads]) {
      if (gen !== sessionGen) return;
      const latest = pendingReads.get(conversationId);
      if (latest === undefined || latest !== height) continue;
      try {
        await emitReadWithAck(current, conversationId, height);
        if (gen !== sessionGen) return;
        const afterAck = pendingReads.get(conversationId);
        if (afterAck !== undefined && afterAck <= height) {
          pendingReads.delete(conversationId);
          void pendingReadDelete(conversationId);
        }
      } catch (err) {
        // 保留 pending,断线重连的 connect 钩子会再次 flush。
        console.warn('[chat] read ack failed, will retry on reconnect', err);
      }
    }
  } finally {
    flushingReads = false;
    if (readFlushRequested && gen === sessionGen && socket?.connected) {
      readFlushRequested = false;
      void flushPendingReads();
    }
  }
}

function emitReadWithAck(
  current: Socket,
  conversationId: string,
  height: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    current
      .timeout(READ_ACK_TIMEOUT_MS)
      .emit(
        CHAT_EVENTS.read,
        { conversationId, height },
        (err: Error | null, ack: ChatReadAck) => {
          if (err) {
            reject(err);
            return;
          }
          if (!ack || ack.ok !== true) {
            reject(new Error(`read ack rejected: ${JSON.stringify(ack)}`));
            return;
          }
          resolve();
        },
      );
  });
}

/** 批量查询在线状态并写入 store(ack 一次性;后续变化靠服务端广播)。 */
export function queryChatPresence(userIds: string[]): void {
  const current = socket;
  if (!current?.connected || userIds.length === 0) return;
  current
    .timeout(READ_ACK_TIMEOUT_MS)
    .emit(
      CHAT_EVENTS.presence,
      { userIds },
      (err: Error | null, result: Record<string, boolean>) => {
        if (err || !result) return;
        const store = useChatStore.getState();
        for (const [userId, online] of Object.entries(result)) {
          if (typeof online === 'boolean') store.applyPresence(userId, online);
        }
      },
    );
}

/** 会话级已读：上报最新水位 + 本地未读乐观归零(消息页点入/滑动动作用)。 */
export function markConversationRead(
  conversationId: string,
  height: number,
): void {
  markChatRead(conversationId, height);
  useChatStore.getState().markConversationReadLocal(conversationId);
}

/** G-02 撤回:带 ack;权限与广播由服务端收口,失败抛 ChatSendError(code)。 */
export function revokeChatMessage(
  conversationId: string,
  messageId: string,
): Promise<void> {
  const current = socket;
  if (!current?.connected) {
    return Promise.reject(
      new ChatSendError('CHAT_NOT_CONNECTED', 'socket 未连接'),
    );
  }
  return new Promise<void>((resolve, reject) => {
    current
      .timeout(READ_ACK_TIMEOUT_MS)
      .emit(
        CHAT_EVENTS.revoke,
        { conversationId, messageId },
        (err: Error | null, ack: ChatReadAck) => {
          if (err) {
            reject(new ChatSendError('CHAT_ACK_TIMEOUT', err.message));
            return;
          }
          if (!ack || ack.ok !== true) {
            reject(
              new ChatSendError(
                ack?.code ?? 'CHAT_INVALID_PAYLOAD',
                ack && 'message' in ack ? ack.message : undefined,
              ),
            );
            return;
          }
          resolve();
        },
      );
  });
}

/**
 * G-07 送达上报:无 ack 尽力而为(丢了下一条消息会报更高水位),
 * 本地只增不减 + 短节流,避免消息洪峰逐条打点。
 */
const deliveredReportedAt = new Map<string, { height: number; at: number }>();
/** 窗口内攒下的最高待报水位(conversationId → height)。 */
const deliveredPending = new Map<string, number>();
const deliveredTimers = new Map<string, ReturnType<typeof setTimeout>>();
const DELIVERED_THROTTLE_MS = 1_000;

export function reportChatDelivered(
  conversationId: string,
  height: number,
): void {
  if (!Number.isInteger(height) || height <= 0) return;
  const current = socket;
  if (!current?.connected) return;
  const prior = deliveredReportedAt.get(conversationId);
  // 只增不减:更低或相等的水位没有任何信息量。
  if (prior && prior.height >= height) return;
  const pending = deliveredPending.get(conversationId) ?? 0;
  if (height > pending) deliveredPending.set(conversationId, height);
  const now = Date.now();
  if (!prior || now - prior.at >= DELIVERED_THROTTLE_MS) {
    flushDelivered(conversationId);
    return;
  }
  // 窗口内:攒着,窗口结束时只发最高的那个。
  //
  // 原来的「节流」只挡得住重复或更低的水位,而每条新消息的 height 都更高 ——
  // 于是它一条都挡不住:群里一次消息洪峰,每个成员对每条消息各发一个 delivered,
  // N 人 × M 条条条上行,自己就是一场实时事件风暴。
  if (deliveredTimers.has(conversationId)) return;
  const timer = setTimeout(
    () => {
      deliveredTimers.delete(conversationId);
      flushDelivered(conversationId);
    },
    DELIVERED_THROTTLE_MS - (now - prior.at),
  );
  timer.unref?.();
  deliveredTimers.set(conversationId, timer);
}

function flushDelivered(conversationId: string): void {
  const height = deliveredPending.get(conversationId);
  if (height === undefined) return;
  const current = socket;
  if (!current?.connected) return;
  const prior = deliveredReportedAt.get(conversationId);
  if (prior && prior.height >= height) {
    deliveredPending.delete(conversationId);
    return;
  }
  deliveredPending.delete(conversationId);
  deliveredReportedAt.set(conversationId, { height, at: Date.now() });
  current.emit(CHAT_EVENTS.delivered, { conversationId, height });
}

/** G-07 表情回应:带 ack;失败抛 ChatSendError(code)。 */
export function sendChatReaction(
  conversationId: string,
  messageId: string,
  emoji: string,
  op: 'add' | 'remove',
): Promise<void> {
  const current = socket;
  if (!current?.connected) {
    return Promise.reject(
      new ChatSendError('CHAT_NOT_CONNECTED', 'socket 未连接'),
    );
  }
  return new Promise<void>((resolve, reject) => {
    current
      .timeout(READ_ACK_TIMEOUT_MS)
      .emit(
        CHAT_EVENTS.reaction,
        { conversationId, messageId, emoji, op },
        (err: Error | null, ack: ChatReadAck) => {
          if (err) {
            reject(new ChatSendError('CHAT_ACK_TIMEOUT', err.message));
            return;
          }
          if (!ack || ack.ok !== true) {
            reject(
              new ChatSendError(
                ack?.code ?? 'CHAT_INVALID_PAYLOAD',
                ack && 'message' in ack ? ack.message : undefined,
              ),
            );
            return;
          }
          resolve();
        },
      );
  });
}

/** G-07 消息编辑:带 ack;权限/窗口/敏感词由服务端判。 */
export function sendChatEditMessage(
  conversationId: string,
  messageId: string,
  text: string,
): Promise<void> {
  const current = socket;
  if (!current?.connected) {
    return Promise.reject(
      new ChatSendError('CHAT_NOT_CONNECTED', 'socket 未连接'),
    );
  }
  return new Promise<void>((resolve, reject) => {
    current
      .timeout(READ_ACK_TIMEOUT_MS)
      .emit(
        CHAT_EVENTS.edit,
        { conversationId, messageId, content: { text } },
        (err: Error | null, ack: ChatReadAck) => {
          if (err) {
            reject(new ChatSendError('CHAT_ACK_TIMEOUT', err.message));
            return;
          }
          if (!ack || ack.ok !== true) {
            reject(
              new ChatSendError(
                ack?.code ?? 'CHAT_INVALID_PAYLOAD',
                ack && 'message' in ack ? ack.message : undefined,
              ),
            );
            return;
          }
          resolve();
        },
      );
  });
}

/** 正在输入：本地节流,无 ack 尽力而为。 */
export function sendChatTyping(conversationId: string): void {
  const current = socket;
  if (!current?.connected) return;
  const now = Date.now();
  const last = typingSentAt.get(conversationId) ?? 0;
  if (now - last < TYPING_THROTTLE_MS) return;
  typingSentAt.set(conversationId, now);
  current.emit(CHAT_EVENTS.typing, { conversationId });
}
