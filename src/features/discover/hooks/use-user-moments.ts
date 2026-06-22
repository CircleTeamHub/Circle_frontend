import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchUserMoments } from '@/services/api/moments';
import type { MomentPost } from '@/types';

const PAGE_SIZE = 20;

interface UseUserMomentsResult {
  moments: MomentPost[];
  loading: boolean;
  refreshing: boolean;
  hasMore: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
}

/** 拉取某个用户的朋友圈相册（分页、下拉刷新、去重）。 */
export function useUserMoments(userId: string): UseUserMomentsResult {
  const { t } = useTranslation();
  const [moments, setMoments] = useState<MomentPost[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (nextPage: number, replace: boolean) => {
      if (!userId) return;
      try {
        setError(null);
        const result = await fetchUserMoments(userId, {
          page: nextPage,
          limit: PAGE_SIZE,
        });
        setMoments((prev) => {
          const base = replace ? [] : prev;
          const seen = new Set(base.map((m) => m.id));
          const merged = [...base];
          for (const item of result.items) {
            if (!seen.has(item.id)) {
              seen.add(item.id);
              merged.push(item);
            }
          }
          return merged;
        });
        setHasMore(result.hasMore);
        setPage(nextPage);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('common.networkError'));
      }
    },
    [userId, t],
  );

  useEffect(() => {
    setLoading(true);
    void load(1, true).finally(() => setLoading(false));
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load(1, true);
    setRefreshing(false);
  }, [load]);

  const loadMore = useCallback(async () => {
    if (loading || refreshing || !hasMore) return;
    setLoading(true);
    await load(page + 1, false);
    setLoading(false);
  }, [loading, refreshing, hasMore, page, load]);

  return { moments, loading, refreshing, hasMore, error, refresh, loadMore };
}
