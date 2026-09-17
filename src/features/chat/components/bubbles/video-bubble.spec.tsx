import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { Image } from 'expo-image';
import { VideoBubble } from './video-bubble';
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
        return <View testID={props.testID} />;
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
jest.mock('expo-video', () => {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    useVideoPlayer: () => ({ replaceAsync: jest.fn(), play: jest.fn(), loop: false }),
    VideoView: () => <View />,
  };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
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
});

describe('VideoBubble poster', () => {
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

  beforeEach(() => {
    clearDiskCache.mockClear();
    mockStorageValues().clear();
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
      expect(mockStorageValues().get('chat.imageDiskCacheClearedPolicies')).toContain(
        'u1|viewer:off|burn:c1@t1',
      ),
    );
  });

  it('does not clear again for a policy an image bubble already handled', async () => {
    mockStorageValues().set(
      'chat.imageDiskCacheClearedPolicies',
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
