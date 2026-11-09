import { useDiscoverStore } from '@/features/discover/store/use-discover-store';
import { reportHandledFailure } from '@/observability/report-failure';
import { markCirclePlazaSeen } from '@/services/api/plaza';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import {
  clearCirclePlazaUpdate,
  openCirclePlazaUpdate,
} from './circle-plaza-update';

jest.mock('@/services/api/plaza', () => ({ markCirclePlazaSeen: jest.fn() }));
jest.mock('@/observability/report-failure', () => ({
  reportHandledFailure: jest.fn(),
}));
jest.mock('@/features/discover/store/use-discover-store', () => ({
  useDiscoverStore: { getState: jest.fn() },
}));

const mockSeen = markCirclePlazaSeen as jest.MockedFunction<typeof markCirclePlazaSeen>;
const mockDiscoverState = useDiscoverStore.getState as unknown as jest.Mock;
const fetchPlazaPosts = jest.fn();

const dotIsLit = () => useTabBadgeStore.getState().circlePlazaHasUpdate;
const lightDot = () => useTabBadgeStore.getState().setCirclePlazaHasUpdate(true);

beforeEach(() => {
  jest.clearAllMocks();
  useTabBadgeStore.getState().reset();
  mockSeen.mockResolvedValue(undefined);
  mockDiscoverState.mockReturnValue({ plazaLatestRequestId: 3, fetchPlazaPosts });
});

describe('openCirclePlazaUpdate', () => {
  it('clears the dot, tells the server and loads the newest list exactly once', () => {
    lightDot();

    openCirclePlazaUpdate();

    expect(dotIsLit()).toBe(false);
    expect(mockSeen).toHaveBeenCalledTimes(1);
    expect(fetchPlazaPosts).toHaveBeenCalledTimes(1);
    expect(fetchPlazaPosts).toHaveBeenCalledWith(true);
  });

  it('does nothing when the dot is off, so switching tabs costs no request', () => {
    openCirclePlazaUpdate();

    expect(mockSeen).not.toHaveBeenCalled();
    expect(fetchPlazaPosts).not.toHaveBeenCalled();
  });

  it('leaves the first load to the screen when the list has never been requested', () => {
    mockDiscoverState.mockReturnValue({ plazaLatestRequestId: 0, fetchPlazaPosts });
    lightDot();

    openCirclePlazaUpdate();

    expect(dotIsLit()).toBe(false);
    expect(mockSeen).toHaveBeenCalledTimes(1);
    expect(fetchPlazaPosts).not.toHaveBeenCalled();
  });

  it('only consumes once when tapped twice in a row', () => {
    lightDot();

    openCirclePlazaUpdate();
    openCirclePlazaUpdate();

    expect(mockSeen).toHaveBeenCalledTimes(1);
    expect(fetchPlazaPosts).toHaveBeenCalledTimes(1);
  });
});

describe('clearCirclePlazaUpdate', () => {
  it('clears a lit dot and records the visit without loading the list itself', () => {
    lightDot();

    clearCirclePlazaUpdate();

    expect(dotIsLit()).toBe(false);
    expect(mockSeen).toHaveBeenCalledTimes(1);
    expect(fetchPlazaPosts).not.toHaveBeenCalled();
  });

  // 服务端算有更新、本地红点却灭着（信号被限频吞了）时下拉刷新：不上报的话，
  // 下一帧快照会为刚看过的帖子再亮一次。
  it('records the visit even when the dot is off locally', () => {
    clearCirclePlazaUpdate();

    expect(mockSeen).toHaveBeenCalledTimes(1);
  });

  it('reports a failed seen request instead of leaving it unhandled', async () => {
    const failure = new Error('offline');
    mockSeen.mockRejectedValue(failure);
    lightDot();

    clearCirclePlazaUpdate();
    await Promise.resolve();
    await Promise.resolve();

    expect(reportHandledFailure).toHaveBeenCalledWith('circlePlaza', 'markSeen', failure);
  });
});
