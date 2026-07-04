import type { CirclePlazaPost } from '@/types';

export type DiscoverFeedState = {
  plazaPosts: CirclePlazaPost[];
  // Keyset cursor for the next page (null = start from newest). Replaces page
  // numbers so a prepended post can't shift the pagination window.
  plazaCursor: string | null;
  plazaHasMore: boolean;
  plazaLoading: boolean;
  plazaRefreshing: boolean;
  plazaQueryVersion: number;
  plazaLatestRequestId: number;
};

type ApplyPlazaFetchSuccessArgs = {
  reset: boolean;
  nextCursor: string | null;
  items: CirclePlazaPost[];
  hasMore: boolean;
  requestQueryVersion: number;
  requestId: number;
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
    plazaCursor: args.nextCursor,
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
