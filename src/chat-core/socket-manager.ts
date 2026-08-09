import { io, type Socket } from 'socket.io-client';
import { CHAT_WS_URL } from '@/constants/config';
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

  const gen = sessionGen;
  store.setConnecting(true);
  store.setCurrentUserId(userId);

  // token 走握手 auth 帧，绝不进 URL query（与 realtime 网关同一条安全线）。
  const next = io(CHAT_WS_URL, {
    path: CHAT_WS_PATH,
    transports: ['websocket'],
    auth: { token },
  });

  next.on('connect', () => {
    if (gen !== sessionGen) return;
    const state = useChatStore.getState();
    state.setConnecting(false);
    state.setConnected(true);
    state.setError(null);
    void flushPendingReads();
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
  if (height > prior) pendingReads.set(conversationId, height);
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
