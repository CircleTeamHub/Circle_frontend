import { ApiError } from './api-error';

/**
 * 「这次写操作到底有没有落到服务端」——不知道的那一类。
 *
 * 只有真的不知道才算：请求发出去了，但我们没拿到结论。
 *  - network / timeout / body-read：fetch 没拿到完整结论；即使报 network，连接也
 *    可能在上传完成、服务端提交后才被代理或系统重置。
 *  - 5xx：服务端收到了，可能在提交之后才炸。
 *  - 不是 ApiError 的抛出值：来路不明，保守当成不确定。
 *
 * 明确的 4xx 同样不算：服务端给了结论，重试是对的。
 */
export function isAmbiguousMutationFailure(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  if (
    error.failureKind === 'network' ||
    error.failureKind === 'timeout' ||
    error.failureKind === 'body-read'
  ) {
    return true;
  }
  return error.status >= 500;
}

/**
 * 带幂等键的写操作「还没有定论」：结果不确定，或同一个键的第一次请求还在服务端
 * 处理（IDEMPOTENCY_IN_PROGRESS）。这两种都必须留着键 —— 换新键再发就是第二笔。
 * 其余失败是服务端的明确结论（含同键不同内容 / 键格式错），键可以作废。
 */
export function isUnsettledMutationFailure(error: unknown): boolean {
  return (
    isAmbiguousMutationFailure(error) ||
    (error instanceof ApiError && error.errorCode === 'IDEMPOTENCY_IN_PROGRESS')
  );
}
