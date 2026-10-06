import { fetchMomentsFeed } from '@/services/api/moments';
import { useMomentsStore } from './use-moments-store';
import type { MomentPost, PaginatedResponse } from '@/types';

jest.mock('@/services/api/moments', () => ({
  fetchMomentsFeed: jest.fn(),
}));
jest.mock('@/observability/report-failure', () => ({
  reportHandledFailure: jest.fn(),
}));

const mockFetch = fetchMomentsFeed as jest.MockedFunction<typeof fetchMomentsFeed>;

function page(ids: string[], hasMore: boolean): PaginatedResponse<MomentPost> {
  return {
    items: ids.map((id) => ({ id }) as MomentPost),
    total: ids.length,
    page: 1,
    limit: 20,
    hasMore,
    nextCursor: hasMore ? 'next' : null,
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  useMomentsStore.getState().reset();
});

test('a failed page is not retried until an explicit refresh', async () => {
  mockFetch
    .mockResolvedValueOnce(page(['first'], true))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(page(['recovered'], false));

  await useMomentsStore.getState().fetchMoments(true);
  await expect(useMomentsStore.getState().fetchMoments(false)).rejects.toThrow(
    'offline',
  );

  expect(useMomentsStore.getState().fetchError).toBe(true);
  await useMomentsStore.getState().fetchMoments(false);
  expect(mockFetch).toHaveBeenCalledTimes(2);

  await useMomentsStore.getState().fetchMoments(true);
  expect(mockFetch).toHaveBeenCalledTimes(3);
  expect(useMomentsStore.getState().fetchError).toBe(false);
});
