import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useUserMoments } from './use-user-moments';
import { fetchUserMoments } from '@/services/api/moments';
import type { MomentPost, PaginatedResponse } from '@/types';

jest.mock('@/services/api/moments', () => ({ fetchUserMoments: jest.fn() }));
const mockAuth = { isAuthenticated: true, user: { id: 'owner-a' }, sessionEpoch: 1 };
jest.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign((selector: (state: typeof mockAuth) => unknown) => selector(mockAuth), {
    getState: () => mockAuth,
  }),
}));
// errors.ts 会经由 api/client 拖进 authStore/AsyncStorage 原生模块；spec 只关心
// 「失败时展示的是包装后的文案」，与 AvatarFrameScreens.spec 同款打桩。
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock('react-i18next', () => {
  // Deliberately return a fresh t function on every render. The hook must keep
  // that presentation detail out of the request effect dependencies, otherwise
  // an error state update would start the same feed request again indefinitely.
  return { useTranslation: () => ({ t: (key: string) => key }) };
});

const mockFetch = fetchUserMoments as jest.MockedFunction<typeof fetchUserMoments>;

type MomentPage = PaginatedResponse<MomentPost>;

// The hook only reads `.id` (for dedup) and `.hasMore`, so loose page objects
// are enough for this behavior test.
const pageOf = (
  ids: string[],
  hasMore: boolean,
  nextCursor: string | null = hasMore ? 'next' : null,
) =>
  ({
    items: ids.map((id) => ({ id })),
    total: ids.length,
    page: 1,
    limit: ids.length,
    hasMore,
    nextCursor,
  }) as MomentPage;

beforeEach(() => {
  mockFetch.mockReset();
  Object.assign(mockAuth, { isAuthenticated: true, user: { id: 'owner-a' }, sessionEpoch: 1 });
});

test('loadMore issues a single request when triggered twice rapidly', async () => {
  let resolvePage2: (value: MomentPage) => void = () => {};
  mockFetch
    .mockResolvedValueOnce(pageOf(['a'], true)) // initial page 1
    .mockImplementationOnce(
      () => new Promise((resolve) => (resolvePage2 = resolve)), // page 2 pending
    );

  const { result } = renderHook(() => useUserMoments('user-1'));

  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(mockFetch).toHaveBeenCalledTimes(1);

  // Two near-simultaneous onEndReached firings, before loading state commits.
  await act(async () => {
    result.current.loadMore();
    result.current.loadMore();
  });

  // The inFlightRef guard collapses the duplicate into a single next-page
  // request, keyed by the first page's cursor rather than a page number.
  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(mockFetch).toHaveBeenLastCalledWith('user-1', {
    cursor: 'next',
    limit: 20,
  });

  await act(async () => {
    resolvePage2(pageOf(['b'], false));
  });

  expect(result.current.moments.map((m) => m.id)).toEqual(['a', 'b']);
});

test('a failed request does not allow automatic loadMore retries', async () => {
  mockFetch.mockRejectedValueOnce(new Error('offline'));

  const { result } = renderHook(() => useUserMoments('user-1'));

  await waitFor(() => {
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('common.networkError');
  });

  // FlatList can emit onEndReached repeatedly while an empty album is shorter
  // than the viewport. Once the initial request fails, loadMore must wait for
  // the user's explicit pull-to-refresh instead of issuing another request.
  await act(async () => {
    await result.current.loadMore();
  });

  expect(mockFetch).toHaveBeenCalledTimes(1);
});

test('a fetch that resolves after unmount does not update state or error', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  let resolveLate: (value: MomentPage) => void = () => {};
  mockFetch.mockImplementationOnce(
    () => new Promise((resolve) => (resolveLate = resolve)),
  );

  const { unmount } = renderHook(() => useUserMoments('user-1'));
  unmount();

  // The in-flight request now resolves against an unmounted component; the
  // mountedRef guard must swallow every setState so React logs nothing.
  await act(async () => {
    resolveLate(pageOf(['a'], false));
  });

  expect(errorSpy).not.toHaveBeenCalled();
  errorSpy.mockRestore();
});

test('a stale user fetch cannot overwrite moments after userId changes', async () => {
  let resolveUser1: (value: MomentPage) => void = () => {};
  let resolveUser2: (value: MomentPage) => void = () => {};
  mockFetch
    .mockImplementationOnce(
      () => new Promise((resolve) => (resolveUser1 = resolve)),
    )
    .mockImplementationOnce(
      () => new Promise((resolve) => (resolveUser2 = resolve)),
    );

  const { result, rerender } = renderHook<
    ReturnType<typeof useUserMoments>,
    { userId: string }
  >(
    ({ userId }) => useUserMoments(userId),
    { initialProps: { userId: 'user-1' } },
  );

  rerender({ userId: 'user-2' });

  await act(async () => {
    resolveUser2(pageOf(['b'], false));
  });

  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.moments.map((m) => m.id)).toEqual(['b']);

  await act(async () => {
    resolveUser1(pageOf(['a'], false));
  });

  expect(result.current.moments.map((m) => m.id)).toEqual(['b']);
});

test('a late response cannot restore a previous user after the id is cleared', async () => {
  let resolveLate: (value: MomentPage) => void = () => {};
  mockFetch.mockImplementationOnce(
    () => new Promise((resolve) => (resolveLate = resolve)),
  );

  const { result, rerender } = renderHook<
    ReturnType<typeof useUserMoments>,
    { userId: string }
  >(
    ({ userId }) => useUserMoments(userId),
    { initialProps: { userId: 'user-1' } },
  );

  rerender({ userId: '' });
  await act(async () => {
    resolveLate(pageOf(['stale'], false));
  });

  expect(result.current.moments).toEqual([]);
  expect(result.current.hasMore).toBe(false);
  expect(result.current.error).toBeNull();
});

test('failed refresh preserves the loaded album and allows its next cursor page', async () => {
  mockFetch.mockResolvedValueOnce(pageOf(['cached'], true, 'cached-cursor'))
    .mockRejectedValueOnce(new Error('temporary refresh failure'))
    .mockResolvedValueOnce(pageOf(['next-page'], false));
  const { result } = renderHook(() => useUserMoments('user-1'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => { await result.current.refresh(); });
  expect(result.current.moments.map((m) => m.id)).toEqual(['cached']);
  expect(result.current.error).toBe('common.networkError');
  await act(async () => { await result.current.loadMore(); });
  expect(mockFetch).toHaveBeenLastCalledWith('user-1', { cursor: 'cached-cursor', limit: 20 });
  expect(result.current.moments.map((m) => m.id)).toEqual(['cached', 'next-page']);
});

test('failed pagination stays blocked through a failed refresh until an explicit refresh succeeds', async () => {
  mockFetch.mockResolvedValueOnce(pageOf(['cached'], true, 'page-2'))
    .mockRejectedValueOnce(new Error('page failure'))
    .mockRejectedValueOnce(new Error('refresh failure'))
    .mockResolvedValueOnce(pageOf(['refreshed'], true, 'new-page-2'))
    .mockResolvedValueOnce(pageOf(['more'], false));
  const { result } = renderHook(() => useUserMoments('user-1'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => { await result.current.loadMore(); await result.current.loadMore(); });
  expect(mockFetch).toHaveBeenCalledTimes(2);
  await act(async () => { await result.current.refresh(); });
  await act(async () => { await result.current.loadMore(); });
  expect(mockFetch).toHaveBeenCalledTimes(3);
  await act(async () => { await result.current.refresh(); });
  await act(async () => { await result.current.loadMore(); });
  expect(mockFetch).toHaveBeenLastCalledWith('user-1', { cursor: 'new-page-2', limit: 20 });
  expect(result.current.moments.map((m) => m.id)).toEqual(['refreshed', 'more']);
});

test('a page claiming hasMore without a cursor cannot restart from the first page automatically', async () => {
  mockFetch.mockResolvedValueOnce(pageOf(['cached'], true, null));
  const { result } = renderHook(() => useUserMoments('user-1'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => { await result.current.loadMore(); });
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

test.each(['account', 'epoch'] as const)('cached private moments disappear when the %s changes, and stale requests cannot finish the new load', async (change) => {
  let resolveOld: (value: MomentPage) => void = () => {};
  let resolveNew: (value: MomentPage) => void = () => {};
  mockFetch.mockResolvedValueOnce(pageOf(['private-a'], true))
    .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
    .mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve; }));
  const { result, rerender } = renderHook(() => useUserMoments('user-1'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  act(() => { void result.current.loadMore(); });
  if (change === 'account') mockAuth.user = { id: 'owner-b' };
  mockAuth.sessionEpoch += 1;
  rerender(undefined);
  expect(result.current.moments).toEqual([]);
  expect(result.current.loading).toBe(true);
  await act(async () => { resolveOld(pageOf(['private-late-a'], false)); });
  expect(result.current.moments).toEqual([]);
  expect(result.current.loading).toBe(true);
  await act(async () => { resolveNew(pageOf(['new-session'], false)); });
  expect(result.current.moments.map((m) => m.id)).toEqual(['new-session']);
  expect(result.current.loading).toBe(false);
});

test('logout hides cached moments and invalidates an in-flight refresh', async () => {
  let resolveRefresh: (value: MomentPage) => void = () => {};
  mockFetch.mockResolvedValueOnce(pageOf(['private'], true))
    .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }));
  const { result, rerender } = renderHook(() => useUserMoments('user-1'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  act(() => { void result.current.refresh(); });
  mockAuth.isAuthenticated = false;
  mockAuth.sessionEpoch += 1;
  rerender(undefined);
  expect(result.current.moments).toEqual([]);
  await act(async () => { resolveRefresh(pageOf(['private-late'], true)); });
  expect(result.current.moments).toEqual([]);
  expect(result.current.loading).toBe(false);
  expect(result.current.refreshing).toBe(false);
  await act(async () => { await result.current.refresh(); await result.current.loadMore(); });
  expect(mockFetch).toHaveBeenCalledTimes(2);
});
