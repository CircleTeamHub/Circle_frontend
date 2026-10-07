import { fetchMomentsFeed } from '@/services/api/moments';
import { useMomentsStore } from './use-moments-store';
import { reportHandledFailure } from '@/observability/report-failure';
import type { MomentPost, PaginatedResponse } from '@/types';

jest.mock('@/services/api/moments', () => ({
  fetchMomentsFeed: jest.fn(),
}));
jest.mock('@/observability/report-failure', () => ({
  reportHandledFailure: jest.fn(),
}));

let mockAuth = { user: { id: 'account-a' }, sessionEpoch: 1 };
jest.mock('@/stores/authStore', () => ({
  useAuthStore: { getState: () => mockAuth },
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
  jest.clearAllMocks();
  mockAuth = { user: { id: 'account-a' }, sessionEpoch: 1 };
  mockFetch.mockReset();
  useMomentsStore.getState().reset();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

test.each(['success', 'failure'] as const)(
  'a delayed account A %s cannot change account B feed or loading state',
  async (outcome) => {
    const oldRequest = deferred<PaginatedResponse<MomentPost>>();
    const newRequest = deferred<PaginatedResponse<MomentPost>>();
    mockFetch.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
    const loadingA = useMomentsStore.getState().fetchMoments(true);
    const oldRequestId = useMomentsStore.getState().latestRequestId;

    mockAuth = { user: { id: 'account-b' }, sessionEpoch: 2 };
    useMomentsStore.getState().reset();
    expect(useMomentsStore.getState().moments).toEqual([]);
    const loadingB = useMomentsStore.getState().fetchMoments(true);
    expect(useMomentsStore.getState().latestRequestId).toBeGreaterThan(oldRequestId);
    const before = useMomentsStore.getState();
    if (outcome === 'success') oldRequest.resolve(page(['private-a'], true));
    else oldRequest.reject(new Error('old-session-offline'));
    await loadingA;

    expect(useMomentsStore.getState()).toMatchObject({
      moments: [], cursor: null, refreshing: true, loading: false,
      latestRequestId: before.latestRequestId, fetchError: false,
    });
    expect(reportHandledFailure).not.toHaveBeenCalled();
    newRequest.resolve(page(['private-b'], false));
    await loadingB;
    expect(useMomentsStore.getState().moments.map((item) => item.id)).toEqual(['private-b']);
  },
);

test('a previous login for the same account cannot repopulate the renewed session', async () => {
  const oldRequest = deferred<PaginatedResponse<MomentPost>>();
  mockFetch.mockReturnValueOnce(oldRequest.promise);
  const loading = useMomentsStore.getState().fetchMoments(true);
  mockAuth = { user: { id: 'account-a' }, sessionEpoch: 2 };
  useMomentsStore.getState().reset();
  oldRequest.resolve(page(['previous-login'], true));
  await loading;
  expect(useMomentsStore.getState().moments).toEqual([]);
  expect(useMomentsStore.getState().cursor).toBeNull();
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


test('a failed refresh retains the cached cursor and permits pagination', async () => {
  mockFetch.mockResolvedValueOnce(page(['cached'], true)).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page(['older'], false));
  await useMomentsStore.getState().fetchMoments(true);
  await expect(useMomentsStore.getState().fetchMoments(true)).rejects.toThrow('offline');
  expect(useMomentsStore.getState().fetchError).toBe(false);
  expect(useMomentsStore.getState().cursor).toBe('next');
  await useMomentsStore.getState().fetchMoments(false);
  expect(mockFetch).toHaveBeenLastCalledWith({ cursor: 'next', limit: 20 });
  expect(useMomentsStore.getState().moments.map((item) => item.id)).toEqual(['cached', 'older']);
});
