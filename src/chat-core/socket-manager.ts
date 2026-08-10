import { io, type Socket } from 'socket.io-client';
import { CHAT_WS_URL } from '@/constants/config';
import { backfillConversationSince, loadChatConversations } from './api';
import {
  initChatLocalDb,
  outboxList,
  pendingReadDelete,
  pendingReadUpsert,
  pendingReadsList,
  readLocalConversations,
  readRecentLocalMessages,
} from './local-db';
import { initChatAppBadgeSync } from './app-badge';
import { bindChatEvents, cancelConversationBackfill } from './dispatcher';
import {
  CHAT_EVENTS,
  CHAT_WS_PATH,
  type ChatReadAck,
  type ChatSendAck,
  type ChatSendAckOk,
} from './protocol';
import { useChatStore } from './store';

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

let socket: Socket | null = null;
let sessionGen = 0;
const pendingReads = new Map<string, number>();
let flushingReads = false;
let readFlushRequested = false;
const typingSentAt = new Map<string, number>();

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
  if (socket?.connected && store.currentUserId === userId) return;
  // 换账号才清 store。放在这里而不是调用方,是为了让「挂起 → 重连」这条
  // 路径天然安全:同一账号轮换 token 时列表/消息/pending 已读原样保留,
  // 而切到另一个账号时上一个账号的数据一定先被清掉(跨账号不串数据)。
  if (store.currentUserId !== null && store.currentUserId !== userId) {
    store.reset();
  }
  teardownSocket();
  sessionGen += 1;
  initChatAppBadgeSync();
  // G-01 冷启动水合:开(或切到)本账号的本地库,把快照灌回内存 —— 不等网络。
  void hydrateFromLocalDb(userId);

  const gen = sessionGen;
  store.setConnecting(true);
  store.setCurrentUserId(userId);

  // token 走握手 auth 帧，绝不进 URL query（与 realtime 网关同一条安全线）。
  const next = io(CHAT_WS_URL, {
    path: CHAT_WS_PATH,
    transports: ['websocket'],
    auth: { token },
  });

  // 同一 socket 生命周期内的首连/重连判据(G-13):
  // 首连不做对账(冷启动全量拉取由页面 focus 负责),重连才补断线窗口。
  let hadConnected = false;
  next.on('connect', () => {
    if (gen !== sessionGen) return;
    const isReconnect = hadConnected;
    hadConnected = true;
    const state = useChatStore.getState();
    state.setConnecting(false);
    state.setConnected(true);
    state.setError(null);
    void flushPendingReads();
    if (isReconnect) resyncAfterReconnect();
  });
  next.on('disconnect', () => {
    if (gen !== sessionGen) return;
    useChatStore.getState().setConnected(false);
  });
  next.on('connect_error', (err) => {
    if (gen !== sessionGen) return;
    console.warn('[chat] connect error', err?.message ?? err);
    const state = useChatStore.getState();
    state.setConnecting(false);
    state.setError(err?.message ?? 'connect_error');
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
async function hydrateFromLocalDb(userId: string): Promise<void> {
  try {
    const opened = await initChatLocalDb(userId);
    if (!opened) return;
    const store = useChatStore.getState();
    if (store.currentUserId !== userId) return;
    const conversations = await readLocalConversations();
    const timelines: Record<string, import('./protocol').ChatMessageDto[]> = {};
    for (const conversation of conversations) {
      timelines[conversation.id] = await readRecentLocalMessages(
        conversation.id,
        50,
      );
    }
    useChatStore.getState().hydrateLocalSnapshot(conversations, timelines);
    // outbox:上次没发出去的消息还原成「发送失败」气泡,可长按重发。
    const pending = await outboxList();
    for (const entry of pending) {
      const optimistic = {
        id: `outbox-${entry.d}`,
        conversationId: entry.conversationId,
        height: 0,
        type: entry.payload.type,
        content: entry.payload.content,
        sender: null,
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
    for (const { conversationId, height } of await pendingReadsList()) {
      const prior = pendingReads.get(conversationId) ?? 0;
      if (height > prior) pendingReads.set(conversationId, height);
    }
  } catch (err) {
    console.warn('[chat] local hydrate failed', err);
  }
}

/**
 * G-13 断线重连对账:断开期间的 chat:msg 不会重投,必须主动补,否则那段
 * 消息在已打开的会话里永远不出现、列表未读也停在断线前。
 * ① 重拉会话列表(未读/预览/新会话一次到位,服务端为准);
 * ② 当前打开的会话按本地最高 height 升序追平(与广播同一 ingest 入口,幂等)。
 * 其余会话不逐个补:进入时的历史加载与列表快照已覆盖。
 */
function resyncAfterReconnect(): void {
  void loadChatConversations().catch((err: unknown) =>
    console.warn('[chat] reconnect conversation refresh failed', err),
  );
  const state = useChatStore.getState();
  const active = state.activeConversationId;
  if (!active) return;
  let maxHeight = 0;
  for (const message of state.messagesByConversation[active] ?? []) {
    if (message.height > maxHeight) maxHeight = message.height;
  }
  // 没有任何已确认消息就不补:该会话的首屏历史另有加载路径。
  if (maxHeight <= 0) return;
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
export function sendChatMessage(input: {
  conversationId: string;
  type: string;
  content: Record<string, unknown>;
  d: string;
  replyToId?: string;
}): Promise<ChatSendAckOk> {
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
const DELIVERED_THROTTLE_MS = 1_000;

export function reportChatDelivered(
  conversationId: string,
  height: number,
): void {
  if (!Number.isInteger(height) || height <= 0) return;
  const current = socket;
  if (!current?.connected) return;
  const prior = deliveredReportedAt.get(conversationId);
  const now = Date.now();
  if (
    prior &&
    prior.height >= height &&
    now - prior.at < DELIVERED_THROTTLE_MS
  ) {
    return;
  }
  if (prior && prior.height >= height) return;
  deliveredReportedAt.set(conversationId, { height, at: now });
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
