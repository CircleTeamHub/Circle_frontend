import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Modal } from 'react-native';
import { Image } from 'expo-image';
import { VideoBubble } from './video-bubble';
import { MEDIA_PROGRESS_DELAY_MS } from '@/components/ui/media-image';
import { ImageBubble } from './image-bubble';
import type { ChatMessage } from '@/types';

// 只观察封面和缓存清理:播放归查看器(见 viewer-video-page.spec),主题和头像全部顶掉。
const posterProps: {
  cachePolicy?: unknown;
  source?: { uri?: string; cacheKey?: string };
}[] = [];
jest.mock('expo-image', () => {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Image: Object.assign(
      (props: {
        testID?: string;
        cachePolicy?: unknown;
        source?: { uri?: string; cacheKey?: string };
      }) => {
        posterProps.push(props);
        return <View {...props} />;
      },
      {
        clearDiskCache: jest.fn(() => Promise.resolve()),
        clearMemoryCache: jest.fn(() => Promise.resolve()),
      },
    ),
  };
});
// 「这个焚毁策略下已经清过磁盘缓存」的标记落在 MMKV,和图片气泡共用。
function mockStorageValues(): Map<string, string> {
  const holder = globalThis as { __videoBubbleStorage?: Map<string, string> };
  holder.__videoBubbleStorage ??= new Map();
  return holder.__videoBubbleStorage;
}
jest.mock('@/storage', () => ({
  storage: {
    getString: (key: string) => mockStorageValues().get(key),
    set: (key: string, value: string) => mockStorageValues().set(key, value),
  },
}));
let mockRegistered = false;
let mockNativeIdle: (() => void) | undefined;
jest.mock('expo-video', () => ({ clearVideoCacheAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('@/components/ui/image-viewer', () => ({ ImageViewer: () => null }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: ({ name }: { name: string }) => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return <Text>{name}</Text>;
} }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('./shared', () => ({
  MessageAvatar: () => null,
  BubbleStatusText: () => null,
}));
jest.mock('@/theme', () => ({
  Radius: { md: 12 },
  Spacing: { xs: 4, sm: 8 },
  Typography: { tinyRegular: {}, small: {} },
  useTheme: () => ({ colors: { textSecondary: '#666' } }),
}));

const video = {
  id: 'v1',
  type: 'video',
  videoUrl: 'https://media.example.com/clip.mp4',
  videoWidth: 1280,
  videoHeight: 720,
  videoDuration: 42,
  time: '10:00',
} as unknown as ChatMessage;

beforeEach(() => {
  posterProps.length = 0;
  mockRegistered = false;
  mockNativeIdle = undefined;
  jest.requireMock('expo-video').clearVideoCacheAsync.mockReset().mockResolvedValue(undefined);
});

test('a tap hands this message to the conversation viewer instead of opening its own', () => {
  const onVideoPress = jest.fn();
  render(<VideoBubble message={video} outgoing={false} onVideoPress={onVideoPress} />);
  fireEvent.press(screen.getByLabelText('chat.detail.playVideo'));
  expect(onVideoPress).toHaveBeenCalledWith(video);
  expect(screen.UNSAFE_queryByType(Modal)).toBeNull();
});

test('an unavailable video cannot be opened', () => {
  const onVideoPress = jest.fn();
  render(<VideoBubble message={{ ...video, videoUrl: undefined }} outgoing={false} onVideoPress={onVideoPress} />);
  expect(screen.queryByLabelText('chat.detail.playVideo')).toBeNull();
  expect(screen.getByText('chat.detail.videoUnavailable')).toBeTruthy();
});

// 过了保留期:服务端不再签地址,对象已删。说清楚是「已过期」,不是黑框或「不可用」;
// 长按菜单(删除、引用)照常。
test('an expired video says it expired and keeps its long-press menu', () => {
  const onVideoPress = jest.fn();
  const onLongPress = jest.fn();
  render(
    <VideoBubble
      message={{ ...video, videoUrl: undefined, mediaExpired: true }}
      outgoing={false}
      onVideoPress={onVideoPress}
      onLongPress={onLongPress}
    />,
  );
  expect(screen.getByText('chat.detail.videoExpired')).toBeTruthy();
  expect(screen.queryByText('chat.detail.videoUnavailable')).toBeNull();
  expect(screen.queryByLabelText('chat.detail.playVideo')).toBeNull();
  fireEvent(screen.getByTestId('chat-media-expired'), 'longPress');
  expect(onLongPress).toHaveBeenCalled();
  expect(onVideoPress).not.toHaveBeenCalled();
});

describe('VideoBubble poster', () => {
  // 封面真在下载时播放键让位给中间的下载进度;缓存里的封面马上显示,不挂进度,
  // 播放键也不跟着卸掉重挂 —— 滑动时每个视频划进来都不再让整个气泡重渲染。
  it('keeps the play badge from covering the central poster download progress, only while it really downloads', () => {
    jest.useFakeTimers();
    try {
      render(<VideoBubble message={{ ...video, videoThumbUrl: 'https://media.example.com/poster.jpg' }} outgoing={false} onVideoPress={jest.fn()} />);
      fireEvent(screen.getByTestId('chat-video-poster'), 'loadStart');
      expect(screen.queryByTestId('media-progress-track')).toBeNull();
      expect(screen.getByText('play')).toBeTruthy();
      act(() => {
        jest.advanceTimersByTime(MEDIA_PROGRESS_DELAY_MS);
      });
      expect(screen.getByTestId('media-progress-track')).toBeTruthy();
      expect(screen.queryByText('play')).toBeNull();
      fireEvent(screen.getByTestId('chat-video-poster'), 'loadEnd');
      expect(screen.queryByRole('progressbar')).toBeNull();
      expect(screen.getByText('play')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows the poster frame, cached by its object key, before the video is played', () => {
    render(
      <VideoBubble
        message={
          {
            ...video,
            videoThumbUrl: 'https://media.example.com/poster.jpg?sig=1',
            videoThumbKey: 'chat/u2/poster-clip.jpg',
          } as ChatMessage
        }
        outgoing={false}
        onVideoPress={jest.fn()}
      />,
    );
    expect(screen.getByTestId('chat-video-poster')).toBeTruthy();
    expect(posterProps.at(-1)?.source).toEqual({
      uri: 'https://media.example.com/poster.jpg?sig=1',
      cacheKey: 'chat/u2/poster-clip.jpg',
    });
    expect(posterProps.at(-1)?.cachePolicy).toBe('memory-disk');
  });

  it('keeps the plain dark frame for older videos without a poster', () => {
    render(<VideoBubble message={video} outgoing={false} onVideoPress={jest.fn()} />);
    expect(screen.queryByTestId('chat-video-poster')).toBeNull();
  });

  it('keeps a disappearing video poster out of the disk cache', () => {
    render(
      <VideoBubble
        message={
          {
            ...video,
            burnDurationSec: 30,
            videoThumbUrl: 'https://media.example.com/poster.jpg?sig=1',
          } as ChatMessage
        }
        outgoing={false}
        onVideoPress={jest.fn()}
      />,
    );
    expect(posterProps.at(-1)?.cachePolicy).toBe('memory');
  });
});

describe('VideoBubble disk cache clearing for disappearing videos', () => {
  const clearDiskCache = Image.clearDiskCache as jest.Mock;
  const burning = {
    ...video,
    burnDurationSec: 30,
    videoThumbUrl: 'https://media.example.com/poster.jpg?sig=1',
    videoThumbKey: 'chat/u2/poster-clip.jpg',
  } as ChatMessage;

  it('purges previously cached ordinary video bytes when a burning policy is first encountered', async () => {
    const { clearVideoCacheAsync } = jest.requireMock('expo-video');
    clearVideoCacheAsync.mockClear();
    render(<VideoBubble message={burning} outgoing={false} onVideoPress={jest.fn()} selfDestructCacheKey="burn-policy-video-cache" />);
    await waitFor(() => expect(clearVideoCacheAsync).toHaveBeenCalledTimes(1));
  });

  beforeEach(() => {
    clearDiskCache.mockClear();
    mockStorageValues().clear();
  });

  it.each([false, true])('waits for native idle when a player is still registered (sibling image: %s)', async (siblingImage) => {
    const { clearVideoCacheAsync } = jest.requireMock('expo-video');
    let rejectBusy!: (error: Error) => void;
    clearVideoCacheAsync.mockImplementation((waitForIdle?: boolean) => {
      if (!mockRegistered) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        rejectBusy = reject;
        if (waitForIdle) mockNativeIdle = resolve;
      });
    });
    const policy = `active-video-policy-${siblingImage}`;
    const tree = (enabled: boolean) => <>
      {siblingImage && enabled ? <ImageBubble message={{ ...video, type: 'image', imageUrl: 'https://media.example.com/photo.jpg', burnDurationSec: 30 }} outgoing={false} selfDestructCacheKey={policy} /> : null}
      <VideoBubble message={video} outgoing={false} onVideoPress={jest.fn()} selfDestructEnabled={enabled} selfDestructCacheKey={policy} />
    </>;
    const view = render(tree(false));
    // The conversation viewer may still hold a native player when the policy flips.
    mockRegistered = true;
    view.rerender(tree(true));
    await waitFor(() => expect(clearVideoCacheAsync).toHaveBeenCalledTimes(1));
    expect(mockStorageValues().get('chat.mediaDiskCacheClearedPolicies')).toBeUndefined();
    await act(async () => {
      // JS unmount precedes native unregister. The old API can reject only now,
      // after both sibling hooks have already run and deduplicated the sweep.
      mockRegistered = false;
      if (mockNativeIdle) mockNativeIdle();
      else rejectBusy(new Error('Cannot clear cache while there are active players'));
    });
    await waitFor(() => expect(mockStorageValues().get('chat.mediaDiskCacheClearedPolicies')).toContain(policy));
    expect(clearVideoCacheAsync).toHaveBeenCalledWith(true);
    expect(clearDiskCache).toHaveBeenCalledTimes(1);
  });

  // 封面在焚毁开启之前按普通图片落过盘。只有图片气泡会清磁盘缓存的话,只发视频的
  // 会话开启阅后即焚以后,那些封面会一直留在磁盘上。
  it('clears the image disk cache once for a new disappearing-message policy', async () => {
    render(
      <VideoBubble
        message={burning}
        outgoing={false}
        onVideoPress={jest.fn()}
        selfDestructCacheKey="u1|viewer:off|burn:c1@t1"
      />,
    );
    await waitFor(() => expect(clearDiskCache).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(mockStorageValues().get('chat.mediaDiskCacheClearedPolicies')).toContain(
        'u1|viewer:off|burn:c1@t1',
      ),
    );
  });

  it('does not clear again for a policy an image bubble already handled', async () => {
    mockStorageValues().set(
      'chat.mediaDiskCacheClearedPolicies',
      JSON.stringify(['u1|viewer:off|burn:c1@t1']),
    );
    render(
      <VideoBubble
        message={burning}
        outgoing={false}
        onVideoPress={jest.fn()}
        selfDestructCacheKey="u1|viewer:off|burn:c1@t1"
      />,
    );
    await Promise.resolve();
    expect(clearDiskCache).not.toHaveBeenCalled();
  });

  it('never clears for ordinary videos', async () => {
    render(
      <VideoBubble message={video} outgoing={false} onVideoPress={jest.fn()} selfDestructCacheKey="u1|viewer:off|burn:c1@off" />,
    );
    await Promise.resolve();
    expect(clearDiskCache).not.toHaveBeenCalled();
  });
});

describe('VideoBubble upload progress', () => {
  const pending = { ...video, videoUrl: 'file:///clip.mp4', deliveryId: 'video-delivery', sendStatus: 1 } as ChatMessage;

  it('shows queued upload progress without blocking playback or long press', () => {
    const onLongPress = jest.fn();
    const onVideoPress = jest.fn();
    render(<VideoBubble message={pending} outgoing onLongPress={onLongPress} onVideoPress={onVideoPress} />);
    expect(screen.getByRole('progressbar')).toBeTruthy();
    const preview = screen.getByLabelText('chat.detail.playVideo');
    fireEvent(preview, 'longPress');
    expect(onLongPress).toHaveBeenCalledTimes(1);
    fireEvent.press(preview);
    expect(onVideoPress).toHaveBeenCalledWith(pending);
  });

  it.each([
    { sendStatus: 2, outgoing: true },
    { sendStatus: 3, outgoing: true },
    { sendStatus: 1, outgoing: false },
  ])('hides progress for status $sendStatus with outgoing=$outgoing', ({ sendStatus, outgoing }) => {
    render(<VideoBubble message={{ ...pending, sendStatus } as ChatMessage} outgoing={outgoing} onVideoPress={jest.fn()} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
