import { fetchNewMomentsCount } from '@/services/api/moments';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { checkMomentsUpdate, markMomentsSeen } from './moments-update';

const mockAuth = { isAuthenticated: true, user: { id: 'u1' }, sessionEpoch: 1 };

jest.mock('@/stores/authStore', () => ({
  useAuthStore: { getState: () => mockAuth },
}));
jest.mock('@/services/api/moments', () => ({
  fetchNewMomentsCount: jest.fn(),
}));
jest.mock('@/observability/report-failure', () => ({
  reportHandledFailure: jest.fn(),
}));
jest.mock('@/storage/page-snapshots', () => {
  const saved = new Map<string, unknown>();
  return {
    readPageSnapshot: (userId: string, key: string) =>
      saved.has(`${userId}:${key}`) ? { value: saved.get(`${userId}:${key}`), at: 0 } : null,
    writePageSnapshot: (userId: string, key: string, value: unknown) => {
      saved.set(`${userId}:${key}`, value);
    },
  };
});

const fetchCount = fetchNewMomentsCount as jest.MockedFunction<typeof fetchNewMomentsCount>;

// The watermark is kept per account inside the module: each case uses a fresh account.
let account = 0;
beforeEach(() => {
  account += 1;
  mockAuth.user = { id: `u${account}` };
  fetchCount.mockReset();
  useTabBadgeStore.getState().reset();
});

it('starts counting from now on a device that never opened the feed', async () => {
  await checkMomentsUpdate();

  expect(fetchCount).not.toHaveBeenCalled();
  expect(useTabBadgeStore.getState().momentsHasUpdate).toBe(false);

  fetchCount.mockResolvedValue(2);
  await checkMomentsUpdate();
  expect(fetchCount).toHaveBeenCalledWith(expect.any(String), { friendsOnly: true });
  expect(useTabBadgeStore.getState().momentsHasUpdate).toBe(true);
});

it('lights the dot only for friends posting after the last feed refresh', async () => {
  markMomentsSeen('2026-11-16T00:00:00.000Z');
  fetchCount.mockResolvedValue(0);

  await checkMomentsUpdate();

  expect(fetchCount).toHaveBeenCalledWith('2026-11-16T00:00:00.000Z', { friendsOnly: true });
  expect(useTabBadgeStore.getState().momentsHasUpdate).toBe(false);
});

it('refreshing the feed clears the dot and discards a check that was in flight', async () => {
  markMomentsSeen('2026-11-16T00:00:00.000Z');
  let resolveCount: (count: number) => void = () => undefined;
  fetchCount.mockReturnValue(new Promise((resolve) => { resolveCount = resolve; }));

  const pending = checkMomentsUpdate();
  markMomentsSeen('2026-11-16T01:00:00.000Z');
  resolveCount(3);
  await pending;

  expect(useTabBadgeStore.getState().momentsHasUpdate).toBe(false);
});
