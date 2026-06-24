import { useCallback, useEffect, useRef, useState } from 'react';
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
  // 卸载后禁止再 setState：慢网下打开相册又快速返回会触发
  // update-on-unmounted 警告，并可能污染复用的组件状态。
  const mountedRef = useRef(true);
  // Guards loadMore against overlapping calls (FlatList can fire onEndReached
  // twice before `loading` state commits).
  const inFlightRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(
    async (nextPage: number, replace: boolean) => {
      if (!userId) return;
      try {
        if (mountedRef.current) setError(null);
        const result = await fetchUserMoments(userId, {
          page: nextPage,
          limit: PAGE_SIZE,
        });
        if (!mountedRef.current) return;
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
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : t('common.networkError'));
      }
    },
    [userId, t],
  );

  useEffect(() => {
    setLoading(true);
    void load(1, true).finally(() => {
      if (mountedRef.current) setLoading(false);
    });
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load(1, true);
    if (mountedRef.current) setRefreshing(false);
  }, [load]);

  const loadMore = useCallback(async () => {
    // `loading` is set inside this async tick, so a fast double `onEndReached`
    // can slip past the state check before it commits. An in-flight ref closes
    // that window synchronously, preventing a duplicate same-page request.
    if (inFlightRef.current || loading || refreshing || !hasMore) return;
    inFlightRef.current = true;
    setLoading(true);
    await load(page + 1, false);
    inFlightRef.current = false;
    if (mountedRef.current) setLoading(false);
  }, [loading, refreshing, hasMore, page, load]);

  return { moments, loading, refreshing, hasMore, error, refresh, loadMore };
}
