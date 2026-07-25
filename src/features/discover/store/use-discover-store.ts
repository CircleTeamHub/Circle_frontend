import { create } from 'zustand';
import { ApiError } from '@/services/api/client';
import { fetchPlazaFeed } from '@/services/api/plaza';
import type { CirclePlazaPost } from '@/types';
import {
  applyPlazaFetchFailure,
  applyPlazaFetchSuccess,
} from '@/features/discover/store/discover-state';
import { useDiscoverFilterStore } from '@/features/discover/store/use-discover-filter-store';
import {
  clampCircleFilterIds,
} from '@/features/discover/utils/circle-filter-selection';

interface DiscoverState {
  plazaPosts: CirclePlazaPost[];
  plazaCursor: string | null;
  plazaHasMore: boolean;
  plazaLoading: boolean;
  plazaRefreshing: boolean;
  plazaMembershipRequired: boolean;
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
  plazaCursor: null,
  plazaHasMore: true,
  plazaLoading: false,
  plazaRefreshing: false,
  plazaMembershipRequired: false,
  plazaQueryVersion: 0,
  plazaLatestRequestId: 0,
  selectedCircleId: null,
  selectedCity: null,

  fetchPlazaPosts: async (reset = false) => {
    const state = get();
    if (!reset && state.plazaLoading) return;
    if (!reset && !state.plazaHasMore) return;

    // reset starts from the newest (no cursor); paginate follows nextCursor.
    const cursor = reset ? undefined : (state.plazaCursor ?? undefined);
    const requestQueryVersion = state.plazaQueryVersion;
    const requestId = state.plazaLatestRequestId + 1;

    set({
      plazaLatestRequestId: requestId,
      plazaMembershipRequired: false,
      ...(reset
        ? state.plazaPosts.length === 0
          ? { plazaLoading: true, plazaRefreshing: false }
          : { plazaLoading: false, plazaRefreshing: true }
        : { plazaLoading: true }),
    });

    try {
      const { appliedCircleIds, appliedCities } =
        useDiscoverFilterStore.getState();
      const selectedCircleId = state.selectedCircleId ?? undefined;
      const cappedCircleIds = clampCircleFilterIds(appliedCircleIds);
      const circleIds =
        selectedCircleId || cappedCircleIds.length === 0
          ? undefined
          : cappedCircleIds.join(',');
      const cities =
        state.selectedCity || appliedCities.length === 0
          ? undefined
          : appliedCities.join(',');

      const result = await fetchPlazaFeed({
        circleId: selectedCircleId,
        circleIds,
        city: state.selectedCity ?? undefined,
        cities,
        cursor,
        limit: 20,
      });

      set((current) =>
        applyPlazaFetchSuccess(current, {
          reset,
          nextCursor: result.nextCursor ?? null,
          items: result.items,
          hasMore: result.hasMore,
          requestQueryVersion,
          requestId,
        }),
      );
    } catch (error) {
      // plazaMembershipRequired 交由 applyPlazaFetchFailure 在「请求仍是最新」时才写，
      // 避免陈旧的 MEMBERSHIP_REQUIRED 覆盖已到达的新成功态。
      set((current) =>
        applyPlazaFetchFailure(current, {
          requestQueryVersion,
          requestId,
          membershipRequired:
            error instanceof ApiError &&
            error.errorCode === 'PLAZA_MEMBERSHIP_REQUIRED',
        }),
      );
    }
  },

  setPlazaFilter: (circleId, city) => {
    set((current) => ({
      selectedCircleId: circleId,
      selectedCity: city,
      plazaPosts: [],
      plazaCursor: null,
      plazaHasMore: true,
      plazaLoading: false,
      plazaRefreshing: false,
      plazaMembershipRequired: false,
      plazaQueryVersion: current.plazaQueryVersion + 1,
    }));
  },

  prependPlazaPost: (post) =>
    set((s) => ({ plazaPosts: [post, ...s.plazaPosts] })),

  removePlazaPost: (id) =>
    set((s) => ({ plazaPosts: s.plazaPosts.filter((p) => p.id !== id) })),

  reset: () =>
    set((state) => ({
      plazaPosts: [],
      plazaCursor: null,
      plazaHasMore: true,
      plazaLoading: false,
      plazaRefreshing: false,
      plazaMembershipRequired: false,
      // 请求代次单调递增、不清零：否则登出重置后新账号的请求（version 0 / id 1）会和上个
      // 账号仍在途的请求撞号，A 的迟到成功 / 门错误会通过时新守卫覆盖 B 的 feed / 门。
      plazaQueryVersion: state.plazaQueryVersion + 1,
      plazaLatestRequestId: state.plazaLatestRequestId + 1,
      selectedCircleId: null,
      selectedCity: null,
    })),
}));
