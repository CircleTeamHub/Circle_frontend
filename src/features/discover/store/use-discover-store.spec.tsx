import { fetchPlazaFeed } from '@/services/api/plaza';
import { useDiscoverStore } from './use-discover-store';
import type { CirclePlazaPost, PaginatedResponse } from '@/types';

jest.mock('@/services/api/plaza', () => ({ fetchPlazaFeed: jest.fn(), plazaMutatedSince: () => false }));
let mockAuth = { user: { id: 'account-a' }, sessionEpoch: 1, isAuthenticated: true };
jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => mockAuth } }));
jest.mock('@/storage/encrypted-init', () => ({ getEncryptedInstance: () => null }));
jest.mock('@/i18n', () => ({ __esModule: true, default: {} }));
jest.mock('@/storage/page-snapshots', () => ({
  getPageSnapshotRevision: () => 0, readPageSnapshot: () => null,
  writePageSnapshot: jest.fn(), removePageSnapshot: jest.fn(),
}));
jest.mock('@/features/discover/store/use-discover-filter-store', () => ({
  useDiscoverFilterStore: { getState: () => ({ appliedCircleIds: [], appliedCities: [] }) },
}));

type Feed = PaginatedResponse<CirclePlazaPost> & { snapshotAt: string };
const mockFetch = fetchPlazaFeed as jest.MockedFunction<typeof fetchPlazaFeed>;
const snapshotAt = '2026-11-09T01:02:03.456Z';
function page(id = 'post'): Feed {
  return { items: [{ id } as CirclePlazaPost], total: 1, page: 1, limit: 20,
    hasMore: true, nextCursor: 'older', snapshotAt };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}
beforeEach(() => {
  mockFetch.mockReset();
  mockAuth = { user: { id: 'account-a' }, sessionEpoch: 1, isAuthenticated: true };
  useDiscoverStore.getState().reset();
});

test('returns the reset snapshot only after applying the response to the real store', async () => {
  const request = deferred<Feed>();
  mockFetch.mockReturnValueOnce(request.promise);
  const refresh = useDiscoverStore.getState().fetchPlazaPosts(true);
  expect(useDiscoverStore.getState().plazaPosts).toEqual([]);
  request.resolve(page());
  expect(await refresh).toBe(snapshotAt);
  expect(useDiscoverStore.getState()).toMatchObject({
    plazaPosts: [{ id: 'post' }], plazaLoaded: true, plazaLoading: false,
  });
});

test('a failed reset returns null and preserves the cached feed', async () => {
  mockFetch.mockResolvedValueOnce(page('cached')).mockRejectedValueOnce(new Error('offline'));
  await useDiscoverStore.getState().fetchPlazaPosts(true);
  expect(await useDiscoverStore.getState().fetchPlazaPosts(true)).toBeNull();
  expect(useDiscoverStore.getState().plazaPosts).toEqual([{ id: 'cached' }]);
});

test.each(['newer request', 'filter version', 'session'] as const)(
  'a reset discarded by the %s guard returns null', async (guard) => {
    const old = deferred<Feed>();
    mockFetch.mockReturnValueOnce(old.promise).mockResolvedValueOnce(page('new'));
    const refresh = useDiscoverStore.getState().fetchPlazaPosts(true);
    if (guard === 'newer request') await useDiscoverStore.getState().fetchPlazaPosts(true);
    if (guard === 'filter version') useDiscoverStore.getState().setPlazaFilter('circle', null);
    if (guard === 'session') {
      mockAuth = { ...mockAuth, sessionEpoch: 2 };
      useDiscoverStore.getState().reset();
    }
    old.resolve(page('stale'));
    expect(await refresh).toBeNull();
    expect(useDiscoverStore.getState().plazaPosts).not.toContainEqual({ id: 'stale' });
  },
);

test('pagination applies items but never returns a snapshot to acknowledge', async () => {
  mockFetch.mockResolvedValueOnce(page('first')).mockResolvedValueOnce(page('older'));
  await useDiscoverStore.getState().fetchPlazaPosts(true);
  expect(await useDiscoverStore.getState().fetchPlazaPosts(false)).toBeNull();
  expect(useDiscoverStore.getState().plazaPosts).toEqual([{ id: 'first' }, { id: 'older' }]);
});

test('pagination skipped during refresh returns null', async () => {
  const request = deferred<Feed>();
  mockFetch.mockReturnValueOnce(request.promise);
  const refresh = useDiscoverStore.getState().fetchPlazaPosts(true);
  expect(await useDiscoverStore.getState().fetchPlazaPosts(false)).toBeNull();
  expect(mockFetch).toHaveBeenCalledTimes(1);
  request.resolve(page());
  await refresh;
});
