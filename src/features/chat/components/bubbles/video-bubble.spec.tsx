import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ActivityIndicator, Modal } from 'react-native';
import { Image } from 'expo-image';
import { VideoBubble } from './video-bubble';
import { ImageBubble } from './image-bubble';
import type { ChatMessage } from '@/types';

// 只观察封面:expo-video 的播放器/视图、主题和头像全部顶掉。
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
let mockStatusListener: ((event: { status: string }) => void) | undefined;
const mockPlayer = { replaceAsync: jest.fn(() => Promise.resolve()), play: jest.fn(), addListener: jest.fn((_event: string, listener: typeof mockStatusListener) => { mockStatusListener = listener; return { remove: jest.fn() }; }), loop: false };
const mockRelease = jest.fn();
let mockRegistered = false;
let mockNativeIdle: (() => void) | undefined;
jest.mock('expo-video', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    clearVideoCacheAsync: jest.fn(() => Promise.resolve()),
    useVideoPlayer: () => {
      useEffect(() => {
        mockRegistered = true;
        return () => mockRelease();
      }, []);
      return mockPlayer;
    },
    VideoView: () => <View testID="video-player" />,
  };
});
jest.mock('@/components/ui/image-viewer', () => ({ ImageViewer: () => null }));
jest.mock('@/components/app/UploadProgressHost', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { UploadProgressHost: () => <View testID="modal-upload-progress-host" /> };
});
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
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
  mockPlayer.replaceAsync.mockReset().mockResolvedValue(undefined);
  mockPlayer.play.mockClear();
  mockRelease.mockClear();
  mockRegistered = false;
  mockNativeIdle = undefined;
  jest.requireMock('expo-video').clearVideoCacheAsync.mockReset().mockResolvedValue(undefined);
});

test('a tap opens full-screen playback and closing releases the active player', async () => {
  render(<VideoBubble message={video} outgoing={false} />);
  expect(screen.queryByTestId('video-player')).toBeNull();
  expect(screen.queryByTestId('modal-upload-progress-host')).toBeNull();
  fireEvent.press(screen.getByLabelText('chat.detail.playVideo'));
  expect(screen.getByTestId('modal-upload-progress-host')).toBeTruthy();
  expect(screen.UNSAFE_getByType(Modal).props.visible).toBe(true);
  await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(1));
  expect(mockPlayer.replaceAsync).toHaveBeenCalledWith(expect.objectContaining({ uri: video.videoUrl, useCaching: true }));
  fireEvent.press(screen.getByLabelText('common.close'));
  expect(screen.queryByTestId('video-player')).toBeNull();
  expect(mockRelease).toHaveBeenCalledTimes(1);
});

test('shows only a central loading bar until playback is ready and while rebuffering', async () => {
  let resolve!: () => void;
  mockPlayer.replaceAsync.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
  render(<VideoBubble message={video} outgoing={false} />);
  fireEvent.press(screen.getByLabelText('chat.detail.playVideo'));
  expect(screen.getByTestId('media-progress-track')).toBeTruthy();
  expect(screen.UNSAFE_queryByType(ActivityIndicator)).toBeNull();
  await act(async () => resolve());
  expect(screen.getByRole('progressbar')).toBeTruthy();
  act(() => mockStatusListener?.({ status: 'readyToPlay' }));
  expect(screen.queryByRole('progressbar')).toBeNull();
  act(() => mockStatusListener?.({ status: 'loading' }));
  expect(screen.getByTestId('media-progress-track')).toBeTruthy();
  act(() => mockStatusListener?.({ status: 'error' }));
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.getByLabelText('common.retry')).toBeTruthy();
});

test('failed video loading exposes retry in full screen and retries without another inline player', async () => {
  mockPlayer.replaceAsync.mockRejectedValueOnce(new Error('network'));
  render(<VideoBubble message={video} outgoing={false} />);
  fireEvent.press(screen.getByLabelText('chat.detail.playVideo'));
  await waitFor(() => expect(screen.getByLabelText('common.retry')).toBeTruthy());
  expect(mockPlayer.play).not.toHaveBeenCalled();
  fireEvent.press(screen.getByLabelText('common.retry'));
  await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(1));
});

test('closing during loading does not start playback after the modal was dismissed', async () => {
  let resolve!: () => void;
  mockPlayer.replaceAsync.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
  render(<VideoBubble message={video} outgoing={false} />);
  fireEvent.press(screen.getByLabelText('chat.detail.playVideo'));
  fireEvent.press(screen.getByLabelText('common.close'));
  await act(async () => resolve());
  expect(mockPlayer.play).not.toHaveBeenCalled();
  expect(mockRelease).toHaveBeenCalledTimes(1);
});

test('a refreshed signed URL replaces the open full-screen source', async () => {
  const view = render(<VideoBubble message={video} outgoing={false} />);
  fireEvent.press(screen.getByLabelText('chat.detail.playVideo'));
  await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(1));
  view.rerender(<VideoBubble message={{ ...video, videoUrl: 'https://media.example.com/clip.mp4?fresh' }} outgoing={false} />);
  await waitFor(() => expect(mockPlayer.replaceAsync).toHaveBeenLastCalledWith(expect.objectContaining({ uri: 'https://media.example.com/clip.mp4?fresh', useCaching: true })));
  expect(mockRelease).toHaveBeenCalledTimes(1);
});

describe('VideoBubble poster', () => {
  it('keeps disappearing video bytes out of persistent storage', async () => {
    render(<VideoBubble message={{ ...video, burnDurationSec: 30 } as ChatMessage} outgoing={false} />);
    fireEvent.press(screen.getByLabelText('chat.detail.playVideo'));
    await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(1));
    expect(mockPlayer.replaceAsync).toHaveBeenCalledWith({ uri: video.videoUrl, useCaching: false });
  });

  it('keeps the play badge from covering the central poster download progress', () => {
    render(<VideoBubble message={{ ...video, videoThumbUrl: 'https://media.example.com/poster.jpg' }} outgoing={false} />);
    fireEvent(screen.getByTestId('chat-video-poster'), 'loadStart');
    expect(screen.getByTestId('media-progress-track')).toBeTruthy();
    expect(screen.queryByText('play')).toBeNull();
    fireEvent(screen.getByTestId('chat-video-poster'), 'loadEnd');
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText('play')).toBeTruthy();
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
    render(<VideoBubble message={video} outgoing={false} />);
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
    render(<VideoBubble message={burning} outgoing={false} selfDestructCacheKey="burn-policy-video-cache" />);
    await waitFor(() => expect(clearVideoCacheAsync).toHaveBeenCalledTimes(1));
  });

  beforeEach(() => {
    clearDiskCache.mockClear();
    mockStorageValues().clear();
  });

  it.each([false, true])('waits for native idle after a policy closes playback (sibling image: %s)', async (siblingImage) => {
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
      <VideoBubble message={video} outgoing={false} selfDestructEnabled={enabled} selfDestructCacheKey={policy} />
    </>;
    const view = render(tree(false));
    fireEvent.press(screen.getByLabelText('chat.detail.playVideo'));
    await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(1));
    view.rerender(tree(true));
    await waitFor(() => expect(clearVideoCacheAsync).toHaveBeenCalledTimes(1));
    expect(mockRelease).toHaveBeenCalledTimes(1);
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
        selfDestructCacheKey="u1|viewer:off|burn:c1@t1"
      />,
    );
    await Promise.resolve();
    expect(clearDiskCache).not.toHaveBeenCalled();
  });

  it('never clears for ordinary videos', async () => {
    render(
      <VideoBubble message={video} outgoing={false} selfDestructCacheKey="u1|viewer:off|burn:c1@off" />,
    );
    await Promise.resolve();
    expect(clearDiskCache).not.toHaveBeenCalled();
  });
});

describe('VideoBubble upload progress', () => {
  const pending = { ...video, videoUrl: 'file:///clip.mp4', deliveryId: 'video-delivery', sendStatus: 1 } as ChatMessage;

  it('shows queued upload progress without blocking playback or long press', async () => {
    const onLongPress = jest.fn();
    render(<VideoBubble message={pending} outgoing onLongPress={onLongPress} />);
    expect(screen.getByRole('progressbar')).toBeTruthy();
    const preview = screen.getByLabelText('chat.detail.playVideo');
    fireEvent(preview, 'longPress');
    expect(onLongPress).toHaveBeenCalledTimes(1);
    fireEvent.press(preview);
    await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(1));
  });

  it.each([
    { sendStatus: 2, outgoing: true },
    { sendStatus: 3, outgoing: true },
    { sendStatus: 1, outgoing: false },
  ])('hides progress for status $sendStatus with outgoing=$outgoing', ({ sendStatus, outgoing }) => {
    render(<VideoBubble message={{ ...pending, sendStatus } as ChatMessage} outgoing={outgoing} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
