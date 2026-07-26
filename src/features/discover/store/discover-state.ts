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
  plazaMembershipRequired: boolean;
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
  args: {
    requestQueryVersion: number;
    requestId: number;
    membershipRequired: boolean;
  },
): DiscoverFeedState {
  if (
    state.plazaQueryVersion !== args.requestQueryVersion ||
    state.plazaLatestRequestId !== args.requestId
  ) {
    // 陈旧请求（被更新的 reset / filter 变更取代）：不改任何 live 态，包括
    // plazaMembershipRequired —— 否则一个迟到的 PLAZA_MEMBERSHIP_REQUIRED 会盖掉更新
    // 的成功态，把已在展示的 feed 换成持久升级墙。
    return state;
  }

  return {
    ...state,
    plazaLoading: false,
    plazaRefreshing: false,
    plazaMembershipRequired: args.membershipRequired,
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
