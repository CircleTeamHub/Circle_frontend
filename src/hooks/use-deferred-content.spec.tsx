import { act, renderHook } from '@testing-library/react-native';
import { useDeferredContent } from './use-deferred-content';

describe('useDeferredContent', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('首帧返回 false,下一帧才翻成 true', () => {
    const { result } = renderHook(() => useDeferredContent());
    expect(result.current).toBe(false);

    act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(result.current).toBe(true);
  });

  test('还没到下一帧就卸载:取消那一帧,不在卸载后 setState', () => {
    const cancel = jest.spyOn(globalThis, 'cancelAnimationFrame');
    const { unmount } = renderHook(() => useDeferredContent());
    unmount();
    expect(cancel).toHaveBeenCalledTimes(1);
    cancel.mockRestore();
  });
});
