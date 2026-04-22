import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPlazaFetchSuccess,
  type DiscoverFeedState,
} from './discover-state.ts';
import type { CirclePlazaPost } from '@/types';

function makePost(id: string): CirclePlazaPost {
  return {
    id,
    content: id,
    images: [],
    tags: [],
    city: null,
    isHorn: false,
    noteId: null,
    restrictions: {
      vipLevel: null,
      creditScore: null,
      fancyNumber: false,
    },
    viewCount: 0,
    author: {
      id: `author-${id}`,
      nickname: `author-${id}`,
      avatarUrl: null,
      avatarFrame: null,
      accountId: `account-${id}`,
    },
    circle: {
      id: `circle-${id}`,
      name: `circle-${id}`,
    },
    canInteract: true,
    createdAt: new Date(0).toISOString(),
  };
}

function makeState(overrides: Partial<DiscoverFeedState> = {}): DiscoverFeedState {
  return {
    plazaPosts: [],
    plazaPage: 1,
    plazaHasMore: true,
    plazaLoading: true,
    plazaRefreshing: false,
    plazaQueryVersion: 3,
    plazaLatestRequestId: 5,
    ...overrides,
  };
}

test('ignores stale plaza responses from an older filter version', () => {
  const currentState = makeState({
    plazaPosts: [makePost('new-filter-post')],
    plazaPage: 2,
    plazaHasMore: true,
    plazaQueryVersion: 7,
    plazaLatestRequestId: 10,
  });

  const nextState = applyPlazaFetchSuccess(currentState, {
    reset: true,
    page: 1,
    items: [makePost('stale-post')],
    hasMore: false,
    requestQueryVersion: 6,
    requestId: 9,
    snapshotPosts: [],
  });

  assert.deepEqual(nextState, currentState);
});

test('appends plaza results onto the latest state, preserving locally prepended posts', () => {
  const prependedPost = makePost('prepended');
  const currentState = makeState({
    plazaPosts: [prependedPost, makePost('existing')],
    plazaPage: 2,
  });

  const nextState = applyPlazaFetchSuccess(currentState, {
    reset: false,
    page: 2,
    items: [makePost('server-page-2')],
    hasMore: true,
    requestQueryVersion: 3,
    requestId: 5,
    snapshotPosts: [makePost('existing')],
  });

  assert.deepEqual(
    nextState.plazaPosts.map((post) => post.id),
    ['prepended', 'existing', 'server-page-2'],
  );
});
