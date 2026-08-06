import { io, type Socket } from 'socket.io-client';
import { CHAT_WS_URL } from '@/constants/config';
import { bindChatEvents } from './dispatcher';
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
  if (socket?.connected) return;
  disconnectChat();

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
    void flushPendingReads();
  });
  next.on('disconnect', () => {
    if (gen !== sessionGen) return;
    useChatStore.getState().setConnected(false);
  });
  next.on('connect_error', (err) => {
    if (gen !== sessionGen) return;
    console.warn('[chat] connect error', err?.message ?? err);
    useChatStore.getState().setConnecting(false);
  });

  bindChatEvents(next, () => gen === sessionGen);
  socket = next;
}

export function disconnectChat(): void {
  sessionGen += 1;
  pendingReads.clear();
  typingSentAt.clear();
  flushingReads = false;
  readFlushRequested = false;
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  useChatStore.getState().reset();
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
