import { useFocusReloadGate } from '@/hooks/use-focus-reload-gate';
import { reportHandledFailure } from '@/observability/report-failure';
import { fetchCreditEvents, type CreditEvent } from '@/services/api/credit';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

interface CreditEventsState {
  /** null = 还没拉到过；拉到过之后重拉失败仍保留上一份。 */
  events: CreditEvent[] | null;
  loading: boolean;
  failed: boolean;
  retry: () => void;
}

// 信誉值只由服务端改（举报审核等），客户端没有任何写请求会让流水过期。
const neverMutatedByClient = () => false;

/**
 * 信誉值页的近期变动。回到页面时按 useFocusReloadGate 判断要不要重拉：
 * 分数变了（实时推送会更新 authStore）、换了账号或过了窗口才重拉。
 */
export function useCreditEvents(creditScore: number): CreditEventsState {
  const [events, setEvents] = useState<CreditEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const reloadGate = useFocusReloadGate({
    key: creditScore,
    mutatedSince: neverMutatedByClient,
  });

  const load = useCallback(
    async (signal?: { cancelled: boolean }) => {
      const startedAt = Date.now();
      setLoading(true);
      try {
        const next = await fetchCreditEvents();
        if (signal?.cancelled) return;
        setEvents(next);
        setFailed(false);
        reloadGate.markLoaded(startedAt);
      } catch (error) {
        if (signal?.cancelled) return;
        setFailed(true);
        reportHandledFailure('creditEvents', 'fetch', error);
      } finally {
        if (!signal?.cancelled) setLoading(false);
      }
    },
    [reloadGate],
  );

  useFocusEffect(
    useCallback(() => {
      if (reloadGate.shouldSkip()) return;
      const signal = { cancelled: false };
      void load(signal);
      return () => {
        signal.cancelled = true;
      };
    }, [load, reloadGate]),
  );

  const retry = useCallback(() => {
    void load();
  }, [load]);

  return { events, loading, failed, retry };
}
