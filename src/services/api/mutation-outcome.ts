import { ApiError } from './api-error';

/**
 * 「这次写操作到底有没有落到服务端」——不知道的那一类。
 *
 * 只有真的不知道才算：请求发出去了，但我们没拿到结论。
 *  - network / timeout / body-read：没有拿到权威响应；服务端可能已提交。
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
