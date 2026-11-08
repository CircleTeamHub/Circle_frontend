import { act, renderHook } from '@testing-library/react-native';
import { usePullRefresh } from './use-pull-refresh';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test('refreshing stays false until the user pulls', () => {
  const reload = jest.fn(() => Promise.resolve());
  const { result } = renderHook(() => usePullRefresh(reload));
  expect(result.current.refreshing).toBe(false);
  expect(reload).not.toHaveBeenCalled();
});

test('a pull shows the refresh control until that reload settles', async () => {
  const pending = deferred();
  const reload = jest.fn(() => pending.promise);
  const { result } = renderHook(() => usePullRefresh(reload));
  act(() => { result.current.onRefresh(); });
  expect(reload).toHaveBeenCalledTimes(1);
  expect(result.current.refreshing).toBe(true);
  await act(async () => { pending.resolve(); });
  expect(result.current.refreshing).toBe(false);
});
