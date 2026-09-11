import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useCircleNotificationTiers } from './use-circle-notification-tiers';
import { useCircleNotificationStore } from '@/features/discover/store/use-circle-notification-store';
import {
  fetchCircleOfflinePushEnabled,
  updateCircleOfflinePushEnabled,
} from '@/services/api/notifications';
import { topNotice } from '@/components/app/top-notice-store';
import { reportHandledFailure } from '@/observability/report-failure';

jest.mock('@/services/api/notifications', () => ({
  fetchCircleOfflinePushEnabled: jest.fn(),
  updateCircleOfflinePushEnabled: jest.fn(),
}));
jest.mock('@/components/app/top-notice-store', () => ({
  topNotice: { error: jest.fn() },
}));
jest.mock('@/observability/report-failure', () => ({
  reportHandledFailure: jest.fn(),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/storage', () => ({
  mmkvJsonStorage: {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  },
}));

const mockFetch = fetchCircleOfflinePushEnabled as jest.MockedFunction<
  typeof fetchCircleOfflinePushEnabled
>;
const mockUpdate = updateCircleOfflinePushEnabled as jest.MockedFunction<
  typeof updateCircleOfflinePushEnabled
>;

/** 手动控制 resolve/reject 时机，好让两发请求交错回来。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function prefs() {
  const { globalEnabled, soundEnabled, offlineEnabled } =
    useCircleNotificationStore.getState();
  return { globalEnabled, soundEnabled, offlineEnabled };
}

beforeEach(() => {
  jest.clearAllMocks();
  useCircleNotificationStore.setState({
    globalEnabled: true,
    bannerEnabled: true,
    soundEnabled: true,
    offlineEnabled: true,
  });
  mockFetch.mockResolvedValue(true);
  mockUpdate.mockResolvedValue(true);
});

describe('useCircleNotificationTiers', () => {
  it('推给服务端的是「生效值」——总闸关掉时离线推送一并关掉', async () => {
    const { result } = renderHook(() => useCircleNotificationTiers());

    await act(async () => {
      result.current.setGlobalEnabled(false);
    });

    expect(mockUpdate).toHaveBeenCalledWith(false);
    expect(prefs().globalEnabled).toBe(false);
    // 离线档本身没被用户动过，只是被总闸压住 —— 展示值关、存储值不变。
    expect(prefs().offlineEnabled).toBe(true);
    expect(result.current.offlineValue).toBe(false);
  });

  it('声音档不走服务端', async () => {
    const { result } = renderHook(() => useCircleNotificationTiers());
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    mockUpdate.mockClear();

    await act(async () => {
      result.current.setSoundEnabled(false);
    });

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(prefs().soundEnabled).toBe(false);
  });

  // 写失败却留着一个「已关闭」的开关，比报错更糟：用户以为关了，推送照来。
  it('写失败回滚到服务端已确认的取值并提示', async () => {
    mockUpdate.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useCircleNotificationTiers());

    await act(async () => {
      result.current.setOfflineEnabled(false);
    });

    expect(prefs().offlineEnabled).toBe(true);
    expect(topNotice.error).toHaveBeenCalledWith(
      'discover.notifications.syncFailed',
    );
    expect(reportHandledFailure).toHaveBeenCalledWith(
      'circleNotification',
      'offlinePushSync',
      expect.any(Error),
    );
  });

  // 连点两下：第一发迟到才失败。按「取反」回滚的话会把第二发的成功结果也掀掉，
  // 本地停在与服务端相反的那一格。
  it('迟到的失败响应不动本地状态，只有最新那一发算数', async () => {
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    mockUpdate.mockReturnValueOnce(first.promise);
    mockUpdate.mockReturnValueOnce(second.promise);

    const { result } = renderHook(() => useCircleNotificationTiers());

    act(() => {
      result.current.setOfflineEnabled(false);
    });
    act(() => {
      result.current.setOfflineEnabled(true);
    });
    await act(async () => {
      second.resolve(true);
      first.reject(new Error('slow failure'));
      await Promise.resolve();
    });

    expect(prefs().offlineEnabled).toBe(true);
    expect(topNotice.error).not.toHaveBeenCalled();
  });

  // 最新那一发失败时，回滚的目标是「服务端最后确认过的那个状态」，
  // 而不是上一次乐观写入的中间态。
  it('连点之后最新那一发失败，回滚到最后一次被确认的状态', async () => {
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    mockUpdate.mockReturnValueOnce(first.promise);
    mockUpdate.mockReturnValueOnce(second.promise);

    const { result } = renderHook(() => useCircleNotificationTiers());

    act(() => {
      result.current.setOfflineEnabled(false);
    });
    act(() => {
      result.current.setGlobalEnabled(false);
    });
    await act(async () => {
      first.resolve(false);
      second.reject(new Error('failed'));
      await Promise.resolve();
    });

    expect(prefs()).toMatchObject({ globalEnabled: true, offlineEnabled: true });
    expect(topNotice.error).toHaveBeenCalled();
  });

  it('打开设置时以服务端为准校一次离线档', async () => {
    mockFetch.mockResolvedValue(false);
    renderHook(() => useCircleNotificationTiers());

    await waitFor(() => expect(prefs().offlineEnabled).toBe(false));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // 总闸关着时服务端一定是 false，那是总闸的结果，不该反写掉用户的离线档选择。
  it('总闸关着时不用服务端的 false 反写离线档', async () => {
    useCircleNotificationStore.setState({ globalEnabled: false });
    mockFetch.mockResolvedValue(false);
    renderHook(() => useCircleNotificationTiers());

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(prefs().offlineEnabled).toBe(true);
  });

  // 读失败以前是 .catch(() => {})：「关了还在推」这类反馈永远查不到是哪一步断的。
  it('读失败留痕但不打断用户', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));
    renderHook(() => useCircleNotificationTiers());

    await waitFor(() =>
      expect(reportHandledFailure).toHaveBeenCalledWith(
        'circleNotification',
        'offlinePushFetch',
        expect.any(Error),
      ),
    );
    expect(prefs().offlineEnabled).toBe(true);
    expect(topNotice.error).not.toHaveBeenCalled();
  });

  // GET 是在挂载时发的，可能比用户的第一次拨动还慢。
  it('用户已经动过开关之后，迟到的 GET 不反写', async () => {
    const fetchResult = deferred<boolean>();
    mockFetch.mockReturnValue(fetchResult.promise);
    const { result } = renderHook(() => useCircleNotificationTiers());

    await act(async () => {
      result.current.setOfflineEnabled(false);
    });
    await act(async () => {
      fetchResult.resolve(true);
      await Promise.resolve();
    });

    expect(prefs().offlineEnabled).toBe(false);
  });
});
