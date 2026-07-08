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
    plazaCursor: null,
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
    plazaCursor: 'cursor-a',
    plazaHasMore: true,
    plazaQueryVersion: 7,
    plazaLatestRequestId: 10,
  });

  const nextState = applyPlazaFetchSuccess(currentState, {
    reset: true,
    nextCursor: null,
    items: [makePost('stale-post')],
    hasMore: false,
    requestQueryVersion: 6,
    requestId: 9,
  });

  assert.deepEqual(nextState, currentState);
});

test('appends plaza results onto the latest state, preserving locally prepended posts', () => {
  const prependedPost = makePost('prepended');
  const currentState = makeState({
    plazaPosts: [prependedPost, makePost('existing')],
    plazaCursor: 'cursor-1',
  });

  const nextState = applyPlazaFetchSuccess(currentState, {
    reset: false,
    nextCursor: 'cursor-2',
    items: [makePost('server-page-2')],
    hasMore: true,
    requestQueryVersion: 3,
    requestId: 5,
  });

  assert.deepEqual(
    nextState.plazaPosts.map((post) => post.id),
    ['prepended', 'existing', 'server-page-2'],
  );
  // The next page follows the server's cursor, not a page counter.
  assert.equal(nextState.plazaCursor, 'cursor-2');
});
