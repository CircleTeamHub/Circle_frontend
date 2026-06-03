import { create } from 'zustand';
import { fetchMomentsFeed } from '@/services/api/moments';
import type { MomentComment, MomentPost } from '@/types';

interface MomentsState {
  moments: MomentPost[];
  page: number;
  hasMore: boolean;
  loading: boolean;
  refreshing: boolean;
  latestRequestId: number;
  lastRefreshTime: string | null;

  fetchMoments: (reset?: boolean) => Promise<void>;
  prependMoment: (moment: MomentPost) => void;
  removeMoment: (id: string) => void;
  toggleLike: (momentId: string, liked: boolean, likeCount: number) => void;
  addComment: (momentId: string, comment: MomentComment) => void;
  removeComment: (momentId: string, commentId: string) => void;
  reset: () => void;
}

function mergeMoments(
  currentMoments: MomentPost[],
  incomingMoments: MomentPost[],
) {
  // 用户可能在 page 1 抓取后 prependMoment 了一条新动态；后端返回 page 2 时这条同样在
  // 列表里 → 直接 concat 会重复 key 触发 FlatList warning。按 id 去重，后到的覆盖先到的。
  const merged = new Map<string, MomentPost>();
  for (const moment of currentMoments) merged.set(moment.id, moment);
  for (const moment of incomingMoments) merged.set(moment.id, moment);
  return Array.from(merged.values());
}

export const useMomentsStore = create<MomentsState>((set, get) => ({
  moments: [],
  page: 1,
  hasMore: true,
  loading: false,
  refreshing: false,
  latestRequestId: 0,
  lastRefreshTime: null,

  fetchMoments: async (reset = false) => {
    const state = get();
    // reset (pull-to-refresh) 抢占在飞的 paginate —— 否则下拉刷新会因分页正在进行而静默失败。
    // 同模式并发请求才早退。
    if (reset && state.refreshing) return;
    if (!reset && state.loading) return;
    if (!reset && !state.hasMore) return;

    const page = reset ? 1 : state.page;
    const requestId = state.latestRequestId + 1;
    set({
      latestRequestId: requestId,
      ...(reset ? { refreshing: true } : { loading: true }),
    });

    try {
      const result = await fetchMomentsFeed({ page, limit: 20 });
      set((current) => {
        // reset 抢占后，旧 paginate 响应会落在这里，要丢弃避免把 page 推到错误值或
        // 把过期数据塞回去（map dedup 能避免重复 key，但 page+1 / hasMore 还是会污染）。
        if (current.latestRequestId !== requestId) {
          return reset ? { refreshing: false } : { loading: false };
        }
        return {
          moments: reset
            ? result.items
            : mergeMoments(current.moments, result.items),
          page: page + 1,
          hasMore: result.hasMore,
          lastRefreshTime: reset
            ? new Date().toISOString()
            : current.lastRefreshTime,
          loading: false,
          refreshing: false,
        };
      });
    } catch (error) {
      set(reset ? { refreshing: false } : { loading: false });
      if (__DEV__) {
        console.warn('[useMomentsStore] fetchMoments failed', error);
      }
      throw error;
    }
  },

  prependMoment: (moment) =>
    set((s) => ({ moments: [moment, ...s.moments] })),

  removeMoment: (id) =>
    set((s) => ({ moments: s.moments.filter((m) => m.id !== id) })),

  toggleLike: (momentId, liked, likeCount) =>
    set((s) => ({
      moments: s.moments.map((m) =>
        m.id === momentId ? { ...m, isLikedByMe: liked, likeCount } : m,
      ),
    })),

  addComment: (momentId, comment) =>
    set((s) => ({
      moments: s.moments.map((m) =>
        m.id === momentId
          ? {
              ...m,
              comments: [...m.comments, comment],
              commentCount: m.commentCount + 1,
            }
          : m,
      ),
    })),

  removeComment: (momentId, commentId) =>
    set((s) => ({
      moments: s.moments.map((m) =>
        m.id === momentId
          ? {
              ...m,
              comments: m.comments.filter((c) => c.id !== commentId),
              commentCount: Math.max(0, m.commentCount - 1),
            }
          : m,
      ),
    })),

  reset: () =>
    set({
      moments: [],
      page: 1,
      hasMore: true,
      loading: false,
      refreshing: false,
      latestRequestId: 0,
      lastRefreshTime: null,
    }),
}));
