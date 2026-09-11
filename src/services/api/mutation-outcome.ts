import { ApiError } from './api-error';

/**
 * 「这次写操作到底有没有落到服务端」——不知道的那一类。
 *
 * 只有真的不知道才算：请求发出去了，但我们没拿到结论。
 *  - timeout / body-read：连上了、也发出去了，响应没读全；服务端可能已提交。
 *  - 5xx：服务端收到了，可能在提交之后才炸。
 *  - 不是 ApiError 的抛出值：来路不明，保守当成不确定。
 *
 * 断网（failureKind 'network'，fetch 自己 reject）**不算**：连接压根没建立，
 * 请求没离开设备。把它也算成不确定，注册失败时会提示「请先尝试登录或找回
 * 密码」——而账号根本没建出来，用户被推去登录一个不存在的账号。
 *
 * 明确的 4xx 同样不算：服务端给了结论，重试是对的。
 */
export function isAmbiguousMutationFailure(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  if (error.failureKind === 'timeout' || error.failureKind === 'body-read') {
    return true;
  }
  return error.status >= 500;
}
