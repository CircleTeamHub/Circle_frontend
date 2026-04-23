import type { CirclePlazaPost } from '@/types';

export type DiscoverFeedState = {
  plazaPosts: CirclePlazaPost[];
  plazaPage: number;
  plazaHasMore: boolean;
  plazaLoading: boolean;
  plazaRefreshing: boolean;
  plazaQueryVersion: number;
  plazaLatestRequestId: number;
};

type ApplyPlazaFetchSuccessArgs = {
  reset: boolean;
  page: number;
  items: CirclePlazaPost[];
  hasMore: boolean;
  requestQueryVersion: number;
  requestId: number;
  snapshotPosts: CirclePlazaPost[];
};

export function applyPlazaFetchSuccess(
  state: DiscoverFeedState,
  args: ApplyPlazaFetchSuccessArgs,
): DiscoverFeedState {
  if (
    state.plazaQueryVersion !== args.requestQueryVersion ||
    state.plazaLatestRequestId !== args.requestId
  ) {
    return state;
  }

  return {
    ...state,
    plazaPosts: args.reset
      ? args.items
      : mergePlazaPosts(state.plazaPosts, args.items),
    plazaPage: args.page + 1,
    plazaHasMore: args.hasMore,
    plazaLoading: false,
    plazaRefreshing: false,
  };
}

export function applyPlazaFetchFailure(
  state: DiscoverFeedState,
  args: { requestQueryVersion: number; requestId: number },
): DiscoverFeedState {
  if (
    state.plazaQueryVersion !== args.requestQueryVersion ||
    state.plazaLatestRequestId !== args.requestId
  ) {
    return state;
  }

  return {
    ...state,
    plazaLoading: false,
    plazaRefreshing: false,
  };
}

function mergePlazaPosts(
  currentPosts: CirclePlazaPost[],
  incomingPosts: CirclePlazaPost[],
) {
  const merged = new Map<string, CirclePlazaPost>();

  for (const post of currentPosts) {
    merged.set(post.id, post);
  }

  for (const post of incomingPosts) {
    merged.set(post.id, post);
  }

  return Array.from(merged.values());
}
