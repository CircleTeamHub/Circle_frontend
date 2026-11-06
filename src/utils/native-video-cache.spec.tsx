import { clearVideoCacheAsync as clearSourceCache } from 'expo-video/src/VideoModule';
import { clearVideoCacheAsync as clearBuiltCache } from 'expo-video/build/VideoModule';

const mockClear = jest.fn((_waitForIdle?: boolean) => Promise.resolve());
jest.mock('expo-video/src/NativeVideoModule', () => ({ __esModule: true, default: { clearVideoCacheAsync: (waitForIdle?: boolean) => mockClear(waitForIdle) } }));
jest.mock('expo-video/build/NativeVideoModule', () => ({ __esModule: true, default: { clearVideoCacheAsync: (waitForIdle?: boolean) => mockClear(waitForIdle) } }));

test.each([clearSourceCache, clearBuiltCache])('forwards idle waiting and returns the native settlement promise', (clear) => {
  mockClear.mockClear();
  const done = Promise.resolve();
  mockClear.mockReturnValueOnce(done);
  expect(clear(true)).toBe(done);
  expect(mockClear).toHaveBeenLastCalledWith(true);
  clear();
  expect(mockClear).toHaveBeenLastCalledWith(false);
});
