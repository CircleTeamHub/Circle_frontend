import { act, renderHook } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { captureVideoPosterFrame } from '@/features/chat/utils/chat-video-poster';
import { useVideoFrameFallback } from './use-video-frame-fallback';

jest.mock('@/features/chat/utils/chat-video-poster', () => ({ captureVideoPosterFrame: jest.fn() }));

const capture = jest.mocked(captureVideoPosterFrame);

/** 每个用例用自己的 key:截到的帧按 key 记在模块里,跨用例共享。 */
let seq = 0;
const nextKey = () => `message-${++seq}`;

beforeEach(() => {
  capture.mockReset();
});

test('captures a frame from the video once and reuses it for the same message', async () => {
  const key = nextKey();
  capture.mockResolvedValue({ uri: 'file:///cache/frame.jpg' });
  const first = renderHook(() => useVideoFrameFallback('file:///clip.mp4', key, true));
  await act(async () => {});
  expect(first.result.current).toBe('file:///cache/frame.jpg');
  expect(capture).toHaveBeenCalledWith('file:///clip.mp4', undefined);

  // 划出去再划回来(或「发送中 → 已送达」换了视频地址):不再截第二遍。
  const second = renderHook(() => useVideoFrameFallback('https://media.example.com/clip.mp4?sig=2', key, true));
  expect(second.result.current).toBe('file:///cache/frame.jpg');
  await act(async () => {});
  expect(capture).toHaveBeenCalledTimes(1);
});

test('a video whose frame cannot be captured stays dark and is not retried', async () => {
  const key = nextKey();
  capture.mockResolvedValue(null);
  const first = renderHook(() => useVideoFrameFallback('file:///broken.mp4', key, true));
  await act(async () => {});
  expect(first.result.current).toBeUndefined();
  renderHook(() => useVideoFrameFallback('file:///broken.mp4', key, true));
  await act(async () => {});
  expect(capture).toHaveBeenCalledTimes(1);
});

test('captures one video at a time and skips bubbles scrolled away before their turn', async () => {
  let finishFirst!: (value: { uri: string }) => void;
  capture.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));
  const firstKey = nextKey();
  const skippedKey = nextKey();
  const thirdKey = nextKey();
  renderHook(() => useVideoFrameFallback('file:///a.mp4', firstKey, true));
  const skipped = renderHook(() => useVideoFrameFallback('file:///b.mp4', skippedKey, true));
  const third = renderHook(() => useVideoFrameFallback('file:///c.mp4', thirdKey, true));
  await act(async () => {});
  expect(capture).toHaveBeenCalledTimes(1);

  skipped.unmount();
  capture.mockResolvedValue({ uri: 'file:///cache/c.jpg' });
  await act(async () => {
    finishFirst({ uri: 'file:///cache/a.jpg' });
  });
  expect(capture).toHaveBeenCalledTimes(2);
  expect(capture).toHaveBeenLastCalledWith('file:///c.mp4', undefined);
  expect(third.result.current).toBe('file:///cache/c.jpg');
});

test('does nothing when disabled (the message has a poster, or it is a disappearing message)', async () => {
  const hook = renderHook(() => useVideoFrameFallback('file:///clip.mp4', nextKey(), false));
  await act(async () => {});
  expect(hook.result.current).toBeUndefined();
  expect(capture).not.toHaveBeenCalled();
});

test('does nothing on the web, where frames cannot be captured', async () => {
  const original = Platform.OS;
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'web' });
  try {
    renderHook(() => useVideoFrameFallback('https://media.example.com/clip.mp4', nextKey(), true));
    await act(async () => {});
    expect(capture).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => original });
  }
});
