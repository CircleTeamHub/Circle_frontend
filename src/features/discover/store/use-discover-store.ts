import { create } from 'zustand';
import { fetchPlazaFeed } from '@/services/api/plaza';
import type { CirclePlazaPost } from '@/types';
import {
  applyPlazaFetchFailure,
  applyPlazaFetchSuccess,
} from '@/features/discover/store/discover-state';

interface DiscoverState {
  plazaPosts: CirclePlazaPost[];
  plazaPage: number;
  plazaHasMore: boolean;
  plazaLoading: boolean;
  plazaRefreshing: boolean;
  plazaQueryVersion: number;
  plazaLatestRequestId: number;
  selectedCircleId: string | null;
  selectedCity: string | null;

  fetchPlazaPosts: (reset?: boolean) => Promise<void>;
  setPlazaFilter: (circleId: string | null, city: string | null) => void;
  prependPlazaPost: (post: CirclePlazaPost) => void;
  removePlazaPost: (id: string) => void;
  reset: () => void;
}

export const useDiscoverStore = create<DiscoverState>((set, get) => ({
  plazaPosts: [],
  plazaPage: 1,
  plazaHasMore: true,
  plazaLoading: false,
  plazaRefreshing: false,
  plazaQueryVersion: 0,
  plazaLatestRequestId: 0,
  selectedCircleId: null,
  selectedCity: null,

  fetchPlazaPosts: async (reset = false) => {
    const state = get();
    if (!reset && state.plazaLoading) return;
    if (!reset && !state.plazaHasMore) return;

    const page = reset ? 1 : state.plazaPage;
    const requestQueryVersion = state.plazaQueryVersion;
    const requestId = state.plazaLatestRequestId + 1;

    set({
      plazaLatestRequestId: requestId,
      ...(reset
        ? state.plazaPosts.length === 0
          ? { plazaLoading: true, plazaRefreshing: false }
          : { plazaLoading: false, plazaRefreshing: true }
        : { plazaLoading: true }),
    });

    try {
      const result = await fetchPlazaFeed({
        circleId: state.selectedCircleId ?? undefined,
        city: state.selectedCity ?? undefined,
        page,
        limit: 20,
      });

      set((current) =>
        applyPlazaFetchSuccess(current, {
          reset,
          page,
          items: result.items,
          hasMore: result.hasMore,
          requestQueryVersion,
          requestId,
          snapshotPosts: state.plazaPosts,
        }),
      );
    } catch {
      set((current) =>
        applyPlazaFetchFailure(current, {
          requestQueryVersion,
          requestId,
        }),
      );
    }
  },

  setPlazaFilter: (circleId, city) => {
    set((current) => ({
      selectedCircleId: circleId,
      selectedCity: city,
      plazaPosts: [],
      plazaPage: 1,
      plazaHasMore: true,
      plazaLoading: false,
      plazaRefreshing: false,
      plazaQueryVersion: current.plazaQueryVersion + 1,
    }));
  },

  prependPlazaPost: (post) =>
    set((s) => ({ plazaPosts: [post, ...s.plazaPosts] })),

  removePlazaPost: (id) =>
    set((s) => ({ plazaPosts: s.plazaPosts.filter((p) => p.id !== id) })),

  reset: () =>
    set({
      plazaPosts: [],
      plazaPage: 1,
      plazaHasMore: true,
      plazaLoading: false,
      plazaRefreshing: false,
      plazaQueryVersion: 0,
      plazaLatestRequestId: 0,
      selectedCircleId: null,
      selectedCity: null,
    }),
}));
