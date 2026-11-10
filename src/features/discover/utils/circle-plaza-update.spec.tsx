import { useDiscoverStore } from '@/features/discover/store/use-discover-store';
import { reportHandledFailure } from '@/observability/report-failure';
import { markCirclePlazaSeen } from '@/services/api/plaza';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { refreshCirclePlazaUpdate, openCirclePlazaUpdate } from './circle-plaza-update';

jest.mock('@/services/api/plaza', () => ({ markCirclePlazaSeen: jest.fn() }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/features/discover/store/use-discover-store', () => ({
  useDiscoverStore: { getState: jest.fn() },
}));
let mockSessionEpoch = 1;
jest.mock('@/stores/authStore', () => ({
  useAuthStore: { getState: () => ({ sessionEpoch: mockSessionEpoch }) },
}));
const mockSeen = markCirclePlazaSeen as jest.MockedFunction<typeof markCirclePlazaSeen>;
const mockDiscoverState = useDiscoverStore.getState as unknown as jest.Mock;
const fetchPlazaPosts = jest.fn();
const snapshotAt = '2026-11-09T01:02:03.456Z';
const dotIsLit = () => useTabBadgeStore.getState().circlePlazaHasUpdate;
const lightDot = () => useTabBadgeStore.getState().setCirclePlazaHasUpdate(true);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockSessionEpoch = 1;
  useTabBadgeStore.getState().reset();
  mockSeen.mockResolvedValue({ hasUpdate: false });
  fetchPlazaPosts.mockReset().mockResolvedValue(snapshotAt);
  mockDiscoverState.mockReturnValue({ plazaLatestRequestId: 3, plazaLoaded: true, plazaLoading: false,
    plazaRefreshing: false, fetchPlazaPosts });
});

test('waits for the applied feed before clearing and acknowledging exactly its snapshot', async () => {
  const feed = deferred<string | null>();
  fetchPlazaPosts.mockReturnValueOnce(feed.promise);
  lightDot();
  const refresh = refreshCirclePlazaUpdate();
  expect(dotIsLit()).toBe(true);
  expect(mockSeen).not.toHaveBeenCalled();
  expect(fetchPlazaPosts).toHaveBeenCalledWith(true);
  feed.resolve(snapshotAt);
  await refresh;
  expect(dotIsLit()).toBe(false);
  expect(mockSeen).toHaveBeenCalledWith(snapshotAt);
});

test('a failed or stale feed preserves the dot and never acknowledges', async () => {
  fetchPlazaPosts.mockResolvedValueOnce(null);
  lightDot();
  await refreshCirclePlazaUpdate();
  expect(dotIsLit()).toBe(true);
  expect(mockSeen).not.toHaveBeenCalled();
});

test.each([true, false])('seen failure restores a previously %s dot and reports the failure', async (wasLit) => {
  const failure = new Error('offline');
  mockSeen.mockRejectedValueOnce(failure);
  if (wasLit) lightDot();
  await refreshCirclePlazaUpdate();
  expect(dotIsLit()).toBe(wasLit);
  expect(reportHandledFailure).toHaveBeenCalledWith('circlePlaza', 'markSeen', failure);
});

test('a newer post reported by seen leaves the dot lit', async () => {
  mockSeen.mockResolvedValueOnce({ hasUpdate: true });
  await refreshCirclePlazaUpdate();
  expect(dotIsLit()).toBe(true);
});

test.each(['success', 'failure'] as const)('realtime during seen survives a late %s', async (outcome) => {
  const seen = deferred<{ hasUpdate: boolean }>();
  mockSeen.mockReturnValueOnce(seen.promise);
  const refresh = refreshCirclePlazaUpdate();
  await Promise.resolve();
  expect(mockSeen).toHaveBeenCalledTimes(1);
  lightDot();
  if (outcome === 'success') seen.resolve({ hasUpdate: false });
  else seen.reject(new Error('offline'));
  await refresh;
  expect(dotIsLit()).toBe(true);
});

test('acknowledges an applied refresh even when the dot was locally off', async () => {
  await refreshCirclePlazaUpdate();
  expect(mockSeen).toHaveBeenCalledWith(snapshotAt);
});

test.each(['success', 'failure'] as const)('late seen %s cannot change the next session badge', async (outcome) => {
  const seen = deferred<{ hasUpdate: boolean }>();
  mockSeen.mockReturnValueOnce(seen.promise);
  lightDot();
  const refresh = refreshCirclePlazaUpdate();
  await Promise.resolve();
  mockSessionEpoch = 2;
  useTabBadgeStore.getState().reset();
  if (outcome === 'success') seen.resolve({ hasUpdate: true });
  else seen.reject(new Error('offline'));
  await refresh;
  expect(dotIsLit()).toBe(false);
});

describe('openCirclePlazaUpdate', () => {
  it('refreshes a cached feed with a lit dot through the same confirmation flow', async () => {
    lightDot();
    openCirclePlazaUpdate();
    await Promise.resolve();
    expect(fetchPlazaPosts).toHaveBeenCalledTimes(1);
    expect(mockSeen).toHaveBeenCalledWith(snapshotAt);
  });
  it('does nothing when the dot is off', () => {
    openCirclePlazaUpdate();
    expect(fetchPlazaPosts).not.toHaveBeenCalled();
    expect(mockSeen).not.toHaveBeenCalled();
  });
  it('leaves an unloaded feed to the screen without clearing the dot', () => {
    mockDiscoverState.mockReturnValue({ plazaLatestRequestId: 0, fetchPlazaPosts });
    lightDot();
    openCirclePlazaUpdate();
    expect(dotIsLit()).toBe(true);
    expect(mockSeen).not.toHaveBeenCalled();
    expect(fetchPlazaPosts).not.toHaveBeenCalled();
  });
  it('does not start another reset when a refresh is already running', () => {
    mockDiscoverState.mockReturnValue({ plazaLatestRequestId: 3, plazaRefreshing: true, fetchPlazaPosts });
    lightDot();
    openCirclePlazaUpdate();
    expect(fetchPlazaPosts).not.toHaveBeenCalled();
  });
  it('allows a tab tap to retry after a failed first load', async () => {
    mockDiscoverState.mockReturnValue({ plazaLatestRequestId: 1, plazaLoaded: false,
      plazaLoading: false, plazaRefreshing: false, fetchPlazaPosts });
    lightDot();
    openCirclePlazaUpdate();
    await Promise.resolve();
    expect(fetchPlazaPosts).toHaveBeenCalledWith(true);
    expect(mockSeen).toHaveBeenCalledWith(snapshotAt);
  });
});

test('a legacy feed without a usable watermark never clears or confirms', async () => {
  fetchPlazaPosts.mockResolvedValueOnce(null);
  lightDot();
  await refreshCirclePlazaUpdate();
  expect(dotIsLit()).toBe(true);
  expect(mockSeen).not.toHaveBeenCalled();
});

test('a rolling-deploy 404 on seen-through restores the dot without falling back to seen', async () => {
  mockSeen.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { status: 404 }));
  lightDot();
  await refreshCirclePlazaUpdate();
  expect(dotIsLit()).toBe(true);
  expect(mockSeen).toHaveBeenCalledTimes(1);
});
