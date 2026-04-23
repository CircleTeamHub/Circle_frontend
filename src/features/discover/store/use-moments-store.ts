import { create } from 'zustand';
import { fetchMomentsFeed } from '@/services/api/moments';
import type { MomentComment, MomentPost } from '@/types';

interface MomentsState {
  moments: MomentPost[];
  page: number;
  hasMore: boolean;
  loading: boolean;
  lastRefreshTime: string | null;

  fetchMoments: (reset?: boolean) => Promise<void>;
  prependMoment: (moment: MomentPost) => void;
  removeMoment: (id: string) => void;
  toggleLike: (momentId: string, liked: boolean, likeCount: number) => void;
  addComment: (momentId: string, comment: MomentComment) => void;
  removeComment: (momentId: string, commentId: string) => void;
  reset: () => void;
}

export const useMomentsStore = create<MomentsState>((set, get) => ({
  moments: [],
  page: 1,
  hasMore: true,
  loading: false,
  lastRefreshTime: null,

  fetchMoments: async (reset = false) => {
    const state = get();
    if (state.loading) return;
    if (!reset && !state.hasMore) return;

    const page = reset ? 1 : state.page;
    set({ loading: true });

    try {
      const result = await fetchMomentsFeed({ page, limit: 20 });
      set({
        moments: reset ? result.items : [...state.moments, ...result.items],
        page: page + 1,
        hasMore: result.hasMore,
        lastRefreshTime: reset ? new Date().toISOString() : state.lastRefreshTime,
      });
    } finally {
      set({ loading: false });
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
      lastRefreshTime: null,
    }),
}));
