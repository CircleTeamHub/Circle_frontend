import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useUserMoments } from './use-user-moments';
import { fetchUserMoments } from '@/services/api/moments';
import type { MomentPost, PaginatedResponse } from '@/types';

jest.mock('@/services/api/moments', () => ({ fetchUserMoments: jest.fn() }));
jest.mock('react-i18next', () => {
  // Stable t reference, like the real hook — a fresh function each render would
  // bust the useCallback memo and re-fire the load effect endlessly.
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
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
