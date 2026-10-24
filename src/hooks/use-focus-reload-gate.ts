import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useAuthStore } from '@/stores/authStore';

const DEFAULT_MAX_AGE_MS = 30_000;

interface FocusReloadGateOptions {
  /** 失效键:拉过之后它变了(实时事件、版本号…)就必须重拉。用 Object.is 比较。 */
  key: unknown;
  /** since 之后有没有相关的写请求(笔记、好友…);有就必须重拉。 */
  mutatedSince: (since: number) => boolean;
  maxAgeMs?: number;
}

/**
 * 列表页回到前台时要不要跳过重拉。群多、笔记多、好友多的用户进进出出,每次都整页重拉
 * 既费流量又费电;但拉过之后改过任何东西、换了账号、失效键变了、窗口过了,或者时钟
 * 回拨(差值为负),都必须重拉。下拉刷新不经过它。
 *
 * markLoaded 传**请求发出时**的时刻:数据就是那一刻的,期间的写请求要算作「之后」。
 */
export function useFocusReloadGate({
  key,
  mutatedSince,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
}: FocusReloadGateOptions): {
  shouldSkip: () => boolean;
  markLoaded: (startedAt: number) => void;
} {
  const sessionEpoch = useAuthStore((state) => state.sessionEpoch);
  const lastRef = useRef<{ at: number; epoch: number; key: unknown } | null>(null);
  // 失效键、账号经 ref 读:返回的对象引用就不随它们变化。页面把它放进加载函数与聚焦
  // 回调的依赖里 —— 引用一变聚焦回调就重跑、多发一轮请求(失效键是未读数这类频繁
  // 变化的值时尤其明显)。失效键变了,下次 shouldSkip 自然判为「要重拉」。
  const currentRef = useRef({ key, epoch: sessionEpoch });
  useLayoutEffect(() => {
    currentRef.current = { key, epoch: sessionEpoch };
  }, [key, sessionEpoch]);

  const shouldSkip = useCallback(() => {
    const last = lastRef.current;
    const current = currentRef.current;
    if (!last || last.epoch !== current.epoch || !Object.is(last.key, current.key)) {
      return false;
    }
    const age = Date.now() - last.at;
    return age >= 0 && age <= maxAgeMs && !mutatedSince(last.at);
  }, [maxAgeMs, mutatedSince]);

  const markLoaded = useCallback((startedAt: number) => {
    const current = currentRef.current;
    lastRef.current = { at: startedAt, epoch: current.epoch, key: current.key };
  }, []);

  return useMemo(() => ({ shouldSkip, markLoaded }), [markLoaded, shouldSkip]);
}
