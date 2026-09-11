import { renderHook, waitFor } from '@testing-library/react-native';
import { useChatBackgroundImageSource } from './use-chat-background-image-source';
import { resolveChatBackgroundImageSource } from '@/features/chat/utils/chat-background-image';

jest.mock('@/features/chat/utils/chat-background-image', () => ({
  resolveChatBackgroundImageSource: jest.fn(),
}));

const mockResolve = resolveChatBackgroundImageSource as jest.Mock;

function deferred<T>() {
  let settle: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

describe('useChatBackgroundImageSource', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves the stored file name into a renderable uri', async () => {
    mockResolve.mockResolvedValue('file:///documents/chat-backgrounds/bg-1.jpg');

    const { result } = renderHook(() =>
      useChatBackgroundImageSource('chat-bg:bg-1.jpg'),
    );

    // 解析是异步的（原生要 stat、web 要读 IndexedDB），首帧必然还没有图。
    expect(result.current).toBeNull();
    await waitFor(() =>
      expect(result.current).toBe('file:///documents/chat-backgrounds/bg-1.jpg'),
    );
    expect(mockResolve).toHaveBeenCalledWith('chat-bg:bg-1.jpg');
  });

  it('paints no image when there is no preference or the file is gone', async () => {
    const { result, rerender } = renderHook(
      ({ stored }: { stored: string | undefined }) =>
        useChatBackgroundImageSource(stored),
      { initialProps: { stored: undefined } },
    );

    expect(result.current).toBeNull();
    expect(mockResolve).not.toHaveBeenCalled();

    // 文件被「清空数据」删掉时 resolver 返回 null —— 必须退回主题底色，
    // 而不是把一个打不开的 uri 交给 ImageBackground（那画出来就是一片灰）。
    mockResolve.mockResolvedValue(null);
    rerender({ stored: 'chat-bg:bg-gone.jpg' });
    await waitFor(() => expect(mockResolve).toHaveBeenCalledTimes(1));
    expect(result.current).toBeNull();
  });

  it('never shows the previous conversation wallpaper while the next one resolves', async () => {
    const first = deferred<string | null>();
    const second = deferred<string | null>();
    mockResolve
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(
      ({ stored }: { stored: string }) => useChatBackgroundImageSource(stored),
      { initialProps: { stored: 'chat-bg:bg-a.jpg' } },
    );

    first.settle('file:///a.jpg');
    await waitFor(() => expect(result.current).toBe('file:///a.jpg'));

    rerender({ stored: 'chat-bg:bg-b.jpg' });
    // 切换的一瞬间就得放掉上一张，否则新会话会短暂顶着别人的壁纸。
    await waitFor(() => expect(result.current).toBeNull());

    second.settle('file:///b.jpg');
    await waitFor(() => expect(result.current).toBe('file:///b.jpg'));
  });

  it('ignores a stale resolution that lands after the preference already changed', async () => {
    const slow = deferred<string | null>();
    const fast = deferred<string | null>();
    mockResolve.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

    const { result, rerender } = renderHook(
      ({ stored }: { stored: string }) => useChatBackgroundImageSource(stored),
      { initialProps: { stored: 'chat-bg:bg-old.jpg' } },
    );

    rerender({ stored: 'chat-bg:bg-new.jpg' });
    fast.settle('file:///new.jpg');
    await waitFor(() => expect(result.current).toBe('file:///new.jpg'));

    // 旧的那次解析慢了一步才回来，绝不能把已经生效的新壁纸盖掉。
    slow.settle('file:///old.jpg');
    await waitFor(() => expect(result.current).toBe('file:///new.jpg'));
  });

  it('falls back to no image when the resolver rejects', async () => {
    mockResolve.mockRejectedValue(new Error('IndexedDB unavailable'));

    const { result } = renderHook(() =>
      useChatBackgroundImageSource('chat-bg:bg-1.jpg'),
    );

    await waitFor(() => expect(mockResolve).toHaveBeenCalledTimes(1));
    expect(result.current).toBeNull();
  });
});
