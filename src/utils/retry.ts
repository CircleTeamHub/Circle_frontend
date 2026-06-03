/**
 * 通用重试工具：默认行为是"试 2 次（首次 + 1 次重试），退避 400ms"。
 *
 * 不重试的情况：
 *  - 客户端 4xx（除 408 Request Timeout / 429 Too Many Requests）—— 这些是确定性错误，
 *    重试只会复制同一个错误而且消耗后端配额。
 *  - AbortError —— 调用方主动取消。
 *
 * 上层例如登录后立即拉 `/auth/me`、SessionBootstrap 启动时拉 `/auth/me`：
 *  - 一次瞬时网络抖动 → 静默重试一次成功，用户感知不到。
 *  - 真 401 / 403 → 立刻抛错给上层走 clearLocalSession 流程，不无意义地重试。
 */
import { ApiError } from '@/services/api/client';

export interface RetryOptions {
  /** 总尝试次数（含首次）。默认 2。 */
  tries?: number;
  /** 失败后的固定退避时长，毫秒。默认 400。 */
  backoffMs?: number;
  /** 调用方传入的 AbortSignal，aborted 后跳过剩余尝试与等待。 */
  signal?: AbortSignal;
  /** 自定义"是否要重试这个错误"的判定。默认按 4xx / AbortError 跳过。 */
  shouldRetry?: (error: unknown) => boolean;
}

function makeAbortError(): Error {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

function defaultShouldRetry(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') return false;
  if (error instanceof ApiError) {
    const status = error.status;
    // 408 / 429 是"客户端这次撞墙"的可恢复信号，仍允许重试。
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
      return false;
    }
  }
  return true;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(makeAbortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(makeAbortError());
    };
    signal?.addEventListener('abort', onAbort);
  });
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const tries = options.tries ?? 2;
  const backoffMs = options.backoffMs ?? 400;
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;
  const signal = options.signal;

  let lastError: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    if (signal?.aborted) {
      throw makeAbortError();
    }
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isLastAttempt = attempt === tries - 1;
      if (isLastAttempt || !shouldRetry(err)) {
        throw err;
      }
      await delay(backoffMs, signal);
    }
  }

  // 理论不可达：循环要么 return 要么 throw，TypeScript 需要兜底语句。
  throw lastError;
}
