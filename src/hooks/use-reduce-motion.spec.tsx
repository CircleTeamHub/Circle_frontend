import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { useReduceMotion } from './use-reduce-motion';

type Listener = (enabled: boolean) => void;

function mockAccessibility(initial: Promise<boolean>) {
  const listeners: Listener[] = [];
  const remove = jest.fn();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(initial);
  jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockImplementation(((event: string, handler: Listener) => {
      if (event === 'reduceMotionChanged') listeners.push(handler);
      return { remove };
    }) as never);
  return { listeners, remove };
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('is unknown (null) until the system preference resolves, then follows it', async () => {
  let resolve: (enabled: boolean) => void = () => {};
  const { listeners } = mockAccessibility(
    new Promise<boolean>((r) => {
      resolve = r;
    }),
  );

  const { result } = renderHook(() => useReduceMotion());
  expect(result.current).toBeNull();

  await act(async () => {
    resolve(false);
  });
  await waitFor(() => expect(result.current).toBe(false));

  act(() => {
    listeners.forEach((listener) => listener(true));
  });
  expect(result.current).toBe(true);
});

test('a preference change that arrives before the initial read wins', async () => {
  let resolve: (enabled: boolean) => void = () => {};
  const { listeners } = mockAccessibility(
    new Promise<boolean>((r) => {
      resolve = r;
    }),
  );

  const { result } = renderHook(() => useReduceMotion());
  act(() => {
    listeners.forEach((listener) => listener(true));
  });
  await act(async () => {
    resolve(false);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(result.current).toBe(true);
});

test('a failed read falls back to animations enabled and unsubscribes on unmount', async () => {
  const { remove } = mockAccessibility(Promise.reject(new Error('no a11y')));

  const { result, unmount } = renderHook(() => useReduceMotion());
  await waitFor(() => expect(result.current).toBe(false));

  unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});

test('unmount tolerates a listener API that hands back no subscription', async () => {
  // react-native-web 的 AccessibilityInfo.addEventListener 在没有 matchMedia 的
  // 环境(旧 WebView、未 polyfill 的 jsdom)里直接 return undefined。
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(false);
  jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockImplementation((() => undefined) as never);

  const { result, unmount } = renderHook(() => useReduceMotion());
  await waitFor(() => expect(result.current).toBe(false));

  expect(() => unmount()).not.toThrow();
});
