import { create } from 'zustand';
import { Platform } from 'react-native';
import { useAuthStore } from '@/stores/authStore';
import { getEncryptedInstance } from '@/storage/encrypted-init';
import { getPageSnapshotRevision, readPageSnapshot, removePageSnapshot, writePageSnapshot } from '@/storage/page-snapshots';
import { ApiError, isDefinitiveAuthFailure } from '@/services/api/client';
import { fetchPlazaFeed, plazaMutatedSince } from '@/services/api/plaza';
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
  plazaLoaded: boolean;
  hydrate: () => void;

  fetchPlazaPosts: (reset?: boolean) => Promise<string | null>;
  setPlazaFilter: (circleId: string | null, city: string | null) => void;
  prependPlazaPost: (post: CirclePlazaPost) => void;
  removePlazaPost: (id: string) => void;
  reset: () => void;
}

let hydratedScope = '';
function plazaSnapshotKey(state: Pick<DiscoverState, 'selectedCircleId' | 'selectedCity'>): string {
  const filters = useDiscoverFilterStore.getState();
  return `social:plaza-feed:${JSON.stringify([state.selectedCircleId, state.selectedCity, filters.appliedCircleIds, filters.appliedCities])}`;
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
  plazaLoaded: false,

  hydrate: () => {
    const auth = useAuthStore.getState();
    if (!auth.isAuthenticated || !auth.user?.id || (Platform.OS !== 'web' && !getEncryptedInstance())) return;
    const key = plazaSnapshotKey(get());
    const scope = `${auth.user.id}:${auth.sessionEpoch}:${getPageSnapshotRevision()}:${key}`;
    if (scope === hydratedScope) return;
    hydratedScope = scope;
    const saved = readPageSnapshot<CirclePlazaPost[]>(auth.user.id, key);
    set({ plazaPosts: saved?.value ?? [], plazaLoaded: Boolean(saved), plazaLoading: false, plazaRefreshing: false,
      plazaCursor: null, plazaHasMore: !saved, plazaLatestRequestId: get().plazaLatestRequestId + 1 });
  },

  fetchPlazaPosts: async (reset = false) => {
    get().hydrate();
    const state = get();
    const requestAuth = useAuthStore.getState();
    const requestRevision = getPageSnapshotRevision();
    const startedAt = Date.now();
    const snapshotKey = plazaSnapshotKey(state);
    // 刷新(reset)进行中也不分页：refresh 用 plazaRefreshing 标记(而非 plazaLoading),
    // 漏判会让一个并发的 end-reached 分页(requestId 更高)把先返回的 refresh 结果当陈旧
    // 请求丢弃、再把旧游标的一页并到过期列表上,用户的下拉刷新就丢了。
    if (!reset && (state.plazaLoading || state.plazaRefreshing)) return null;
    if (!reset && !state.plazaHasMore) return null;

    // reset starts from the newest (no cursor); paginate follows nextCursor.
    const cursor = reset ? undefined : (state.plazaCursor ?? undefined);
    const requestQueryVersion = state.plazaQueryVersion;
    const requestId = state.plazaLatestRequestId + 1;

    set({
      plazaLatestRequestId: requestId,
      plazaMembershipRequired: false,
      ...(reset
        ? !state.plazaLoaded && state.plazaPosts.length === 0
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

      if (useAuthStore.getState().sessionEpoch !== requestAuth.sessionEpoch) return null;

      let applied = false;
      set((current) => {
        const next = applyPlazaFetchSuccess(current, {
          reset,
          nextCursor: result.nextCursor ?? null,
          items: result.items,
          hasMore: result.hasMore,
          requestQueryVersion,
          requestId,
        });
        if (next === current) return current;
        applied = true;
        if (requestRevision === getPageSnapshotRevision() && !plazaMutatedSince(startedAt)) writePageSnapshot(requestAuth.user?.id, snapshotKey, next.plazaPosts.slice(0, 100));
        return { ...next, plazaLoaded: true };
      });
      return reset && applied ? result.snapshotAt : null;
    } catch (error) {
      if (useAuthStore.getState().sessionEpoch !== requestAuth.sessionEpoch) return null;
      const current = get();
      if (current.plazaLatestRequestId === requestId && current.plazaQueryVersion === requestQueryVersion &&
        useAuthStore.getState().user?.id === requestAuth.user?.id &&
        (isDefinitiveAuthFailure(error) || (error instanceof ApiError && error.status === 404))) {
        removePageSnapshot(requestAuth.user?.id, snapshotKey);
      }
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
      return null;
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
      plazaLoaded: false,
      plazaQueryVersion: current.plazaQueryVersion + 1,
    }));
  },

  prependPlazaPost: (post) =>
    set((s) => ({
      plazaPosts: [post, ...s.plazaPosts.filter((item) => item.id !== post.id)],
    })),

  removePlazaPost: (id) =>
    set((s) => ({ plazaPosts: s.plazaPosts.filter((p) => p.id !== id) })),

  reset: () => {
    hydratedScope = '';
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
      plazaLoaded: false,
    }));
  },
}));
