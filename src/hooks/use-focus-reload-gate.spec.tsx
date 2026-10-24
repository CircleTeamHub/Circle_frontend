import { renderHook } from '@testing-library/react-native';
import { useFocusReloadGate } from './use-focus-reload-gate';

// 列表页回到前台时要不要重拉:群多、笔记多、好友多的用户进进出出,每次都整页重拉很费电,
// 但只要拉过之后改过任何东西、换了账号、失效键变了或窗口过了,就必须重拉。
let mockEpoch = 1;
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (state: { sessionEpoch: number }) => unknown) =>
    selector({ sessionEpoch: mockEpoch }),
}));

let mutatedAt = 0;
const mutatedSince = (since: number) => mutatedAt >= since;

beforeEach(() => {
  mockEpoch = 1;
  mutatedAt = 0;
  jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function setup(maxAgeMs = 30_000) {
  return renderHook(
    ({ key }: { key: unknown }) => useFocusReloadGate({ key, mutatedSince, maxAgeMs }),
    { initialProps: { key: 'k1' as unknown } },
  );
}

describe('useFocusReloadGate', () => {
  test('never skips before a load has succeeded', () => {
    const { result } = setup();
    expect(result.current.shouldSkip()).toBe(false);
  });

  test('skips right after a successful load', () => {
    const { result } = setup();
    result.current.markLoaded(Date.now());
    expect(result.current.shouldSkip()).toBe(true);
  });

  test('reloads once the window has passed', () => {
    const { result } = setup();
    result.current.markLoaded(Date.now());
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000 + 30_001);
    expect(result.current.shouldSkip()).toBe(false);
  });

  test('reloads after any related write since the load', () => {
    const { result } = setup();
    const startedAt = Date.now();
    result.current.markLoaded(startedAt);
    mutatedAt = startedAt;
    expect(result.current.shouldSkip()).toBe(false);
  });

  test('reloads when the invalidation key changes', () => {
    const { result, rerender } = setup();
    result.current.markLoaded(Date.now());
    rerender({ key: 'k2' });
    expect(result.current.shouldSkip()).toBe(false);
  });

  test('reloads for a different account', () => {
    const { result, rerender } = setup();
    result.current.markLoaded(Date.now());
    mockEpoch = 2;
    rerender({ key: 'k1' });
    expect(result.current.shouldSkip()).toBe(false);
  });

  test('a clock moved backwards counts as stale', () => {
    const { result } = setup();
    result.current.markLoaded(Date.now());
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000 - 60_000);
    expect(result.current.shouldSkip()).toBe(false);
  });

  test('the gate keeps its identity across renders, even when the key changes', () => {
    // 页面把它放进聚焦回调的依赖:换引用 = 聚焦回调重跑、多发一轮请求。失效键(未读数等)
    // 变化只影响下次 shouldSkip 的判定,不该让回调重跑。
    const { result, rerender } = setup();
    const first = result.current;
    rerender({ key: 'k1' });
    expect(result.current).toBe(first);
    rerender({ key: 'k2' });
    expect(result.current).toBe(first);
    expect(result.current.shouldSkip()).toBe(false);
  });
});
