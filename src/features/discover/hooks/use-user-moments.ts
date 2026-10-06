import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getApiErrorMessage } from '@/services/api/errors';
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
  // react-i18next 在语言切换或资源加载时可能返回新的 t 引用。把最新翻译放进
  // ref，避免它成为 load 的依赖，进而让初次加载 effect 因为函数身份变化重复发请求。
  const translateRef = useRef(t);
  translateRef.current = t;
  const [moments, setMoments] = useState<MomentPost[]>([]);
  // Keyset cursor for the next page (null = start from newest).
  const [cursor, setCursor] = useState<string | null>(null);
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
  const requestSeqRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(
    async (cursorArg: string | undefined, replace: boolean) => {
      if (!userId) return;
      const requestSeq = ++requestSeqRef.current;
      const requestUserId = userId;
      try {
        if (mountedRef.current) setError(null);
        const result = await fetchUserMoments(requestUserId, {
          cursor: cursorArg,
          limit: PAGE_SIZE,
        });
        if (!mountedRef.current || requestSeq !== requestSeqRef.current) return;
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
        setCursor(result.nextCursor ?? null);
      } catch (err) {
        if (!mountedRef.current || requestSeq !== requestSeqRef.current) return;
        setError(
          getApiErrorMessage(err, translateRef.current('common.networkError')),
        );
      }
    },
    [userId],
  );

  useEffect(() => {
    if (!userId) {
      // 使旧用户的慢请求失效；否则路由切换到空 id 的这一帧里，旧响应仍可能
      // 通过原 requestSeq 写回列表，造成用户短暂看到上一位用户的朋友圈。
      requestSeqRef.current += 1;
      inFlightRef.current = false;
      setMoments([]);
      setCursor(null);
      setHasMore(false);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    void load(undefined, true).finally(() => {
      if (mountedRef.current) setLoading(false);
    });
  }, [load, userId]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load(undefined, true);
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [load]);

  const loadMore = useCallback(async () => {
    // `loading` is set inside this async tick, so a fast double `onEndReached`
    // can slip past the state check before it commits. An in-flight ref closes
    // that window synchronously, preventing a duplicate same-page request.
    // When a page request fails, FlatList can immediately fire onEndReached
    // again because the album is still shorter than the viewport. Keep the
    // failed state retryable via pull-to-refresh, but stop automatic retries
    // until the user explicitly asks for a refresh.
    if (inFlightRef.current || loading || refreshing || !hasMore || error)
      return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      await load(cursor ?? undefined, false);
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, [error, loading, refreshing, hasMore, cursor, load]);

  return { moments, loading, refreshing, hasMore, error, refresh, loadMore };
}
