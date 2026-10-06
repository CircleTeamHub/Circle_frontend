/**
 * 聊天消息发送队列。
 *
 * 原来 socket 没连上就立刻报「发送失败」,ack 超时也直接标红,连上以后不会自己重发:
 * token 轮换、服务端发版重启、网络切换的那一两秒里发的消息全都变红,只能手动长按重发。
 *
 * 现在按会话排队、逐条发:
 * - 没连上就等;连上(resume)后按原顺序接着发,用的还是同一个 d。服务端按 d 幂等,
 *   上一次其实已经落库的只会拿回同一条的 ack,不会重复入库。
 * - 断线、ack 超时、限流这类「过一会儿再发就可能成」的失败留在队头:还连着就隔一会儿
 *   重发,断了就等重连。服务端明确拒收的(敏感词、被拉黑……)立刻判失败,后面的接着发。
 * - 每条最多等 CHAT_SEND_MAX_WAIT_MS:从进队算起还没发出去就判失败(气泡标红,可长按
 *   重发)。已经发出去、正等 ack 的那一次不打断,等它有结果再定。
 * - 同一会话串行:断线期间连发的几条,重连后仍按发送顺序落库;不同会话互不阻塞。
 *
 * 本模块零依赖(连接状态、发射、错误分类都由调用方注入),便于单测。
 */

export const CHAT_SEND_MAX_WAIT_MS = 60_000;

export interface ChatSendQueueItem {
  conversationId: string;
  d: string;
}

export interface ChatSendQueueOptions<TItem extends ChatSendQueueItem, TAck> {
  isConnected: () => boolean;
  /** 发一次并等 ack。reject 的错误交给 retryDelayMs 分类。 */
  emit: (item: TItem) => Promise<TAck>;
  /**
   * 这次失败之后隔多久可以同 d 再发;null 表示重发也没用(服务端明确拒收)。
   * 失败时已经断开的,不按这个延迟重发,而是等 resume。
   */
  retryDelayMs: (error: unknown) => number | null;
  /** 等满时间还没发出去时的错误;stillConnected 区分「一直没连上」和「一直没回 ack」。 */
  waitTimeoutError: (stillConnected: boolean) => Error;
  maxWaitMs?: number;
}

export interface ChatSendQueue<TItem extends ChatSendQueueItem, TAck> {
  enqueue: (item: TItem) => Promise<TAck>;
  /** 连接(重新)可用:各会话队头立刻开发,不再等重试间隔。 */
  resume: () => void;
  /** 会话身份结束(登出、换账号):全部判失败,之后到的 ack 一律忽略。 */
  abortAll: (error: Error) => void;
}

interface PendingSend<TItem, TAck> {
  readonly item: TItem;
  readonly promise: Promise<TAck>;
  readonly resolve: (ack: TAck) => void;
  readonly reject: (error: unknown) => void;
  readonly deadline: ReturnType<typeof setTimeout>;
  inFlight: boolean;
  expired: boolean;
  settled: boolean;
  lastError: unknown;
}

export function createChatSendQueue<TItem extends ChatSendQueueItem, TAck>(
  options: ChatSendQueueOptions<TItem, TAck>,
): ChatSendQueue<TItem, TAck> {
  const maxWaitMs = options.maxWaitMs ?? CHAT_SEND_MAX_WAIT_MS;
  let queues = new Map<string, readonly PendingSend<TItem, TAck>[]>();
  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function clearRetryTimer(conversationId: string): void {
    const timer = retryTimers.get(conversationId);
    if (timer === undefined) return;
    clearTimeout(timer);
    retryTimers.delete(conversationId);
  }

  function settle(
    entry: PendingSend<TItem, TAck>,
    outcome: { ack: TAck } | { error: unknown },
  ): void {
    if (entry.settled) return;
    entry.settled = true;
    clearTimeout(entry.deadline);
    const { conversationId } = entry.item;
    const remaining = (queues.get(conversationId) ?? []).filter(
      (pending) => pending !== entry,
    );
    if (remaining.length > 0) {
      queues.set(conversationId, remaining);
    } else {
      queues.delete(conversationId);
      clearRetryTimer(conversationId);
    }
    if ('ack' in outcome) {
      entry.resolve(outcome.ack);
    } else {
      entry.reject(outcome.error);
    }
    pump(conversationId);
  }

  function expire(entry: PendingSend<TItem, TAck>): void {
    entry.expired = true;
    // 已经发出去的这一次不打断:它回来是成功就算成功,失败就是最终结果。
    if (entry.inFlight) return;
    settle(entry, {
      error: entry.lastError ?? options.waitTimeoutError(options.isConnected()),
    });
  }

  function pump(conversationId: string): void {
    const head = queues.get(conversationId)?.[0];
    if (!head || head.inFlight || retryTimers.has(conversationId)) return;
    if (!options.isConnected()) return;
    head.inFlight = true;
    let attempt: Promise<TAck>;
    try {
      attempt = options.emit(head.item);
    } catch (error) {
      attempt = Promise.reject(error);
    }
    attempt.then(
      (ack) => {
        head.inFlight = false;
        settle(head, { ack });
      },
      (error: unknown) => {
        head.inFlight = false;
        if (head.settled) return;
        const delay = options.retryDelayMs(error);
        if (delay === null || head.expired) {
          settle(head, { error });
          return;
        }
        head.lastError = error;
        // 断开了就等 resume;还连着(ack 超时、被限流)隔一会儿同 d 再发。
        if (!options.isConnected()) return;
        retryTimers.set(
          conversationId,
          setTimeout(() => {
            retryTimers.delete(conversationId);
            pump(conversationId);
          }, delay),
        );
      },
    );
  }

  function enqueue(item: TItem): Promise<TAck> {
    for (const pending of queues.values()) {
      const existing = pending.find((entry) => entry.item.d === item.d);
      if (existing) return existing.promise;
    }
    let resolve!: (ack: TAck) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<TAck>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    const entry: PendingSend<TItem, TAck> = {
      item,
      promise,
      resolve,
      reject,
      deadline: setTimeout(() => expire(entry), maxWaitMs),
      inFlight: false,
      expired: false,
      settled: false,
      lastError: null,
    };
    queues.set(item.conversationId, [
      ...(queues.get(item.conversationId) ?? []),
      entry,
    ]);
    pump(item.conversationId);
    return promise;
  }

  function resume(): void {
    for (const conversationId of [...queues.keys()]) {
      clearRetryTimer(conversationId);
      pump(conversationId);
    }
  }

  function abortAll(error: Error): void {
    const entries = [...queues.values()].flat();
    queues = new Map();
    for (const timer of retryTimers.values()) clearTimeout(timer);
    retryTimers.clear();
    for (const entry of entries) {
      if (entry.settled) continue;
      entry.settled = true;
      clearTimeout(entry.deadline);
      entry.reject(error);
    }
  }

  return { enqueue, resume, abortAll };
}
