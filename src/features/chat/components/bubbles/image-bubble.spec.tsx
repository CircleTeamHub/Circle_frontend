import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { Image } from 'expo-image';
import { ImageBubble } from './image-bubble';
import type { ChatMessage } from '@/types';

// 这条 spec 只关心「这张图片会不会被当成阅后即焚渲染」，所以把主题 / 头像 /
// 观测层全部顶掉，只留下能观察到判定结果的两个出口：缩略图的 cachePolicy 与
// 查看器的 privacyMode。与 location-card.spec 同款做法。
const imageProps: { cachePolicy?: unknown }[] = [];
jest.mock('expo-image', () => {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Image: Object.assign(
      (props: object) => {
        imageProps.push(props as { cachePolicy?: unknown });
        return <View />;
      },
      {
        clearDiskCache: jest.fn(() => Promise.resolve()),
        clearMemoryCache: jest.fn(() => Promise.resolve()),
      },
    ),
  };
});

const viewerModes: unknown[] = [];
jest.mock('@/components/ui/image-viewer', () => {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    ImageViewer: (props: { privacyMode?: unknown }) => {
      viewerModes.push(props.privacyMode);
      return <View />;
    },
  };
});

jest.mock('./shared', () => ({
  MessageAvatar: () => null,
  BubbleStatusText: () => null,
}));

jest.mock('@/observability/report-failure', () => ({
  reportHandledFailure: jest.fn(),
}));

// 「这个策略下清过磁盘缓存」的标记落在 MMKV:冷启动之后还认得。
function mockStorageValues(): Map<string, string> {
  const holder = globalThis as { __imageBubbleStorage?: Map<string, string> };
  holder.__imageBubbleStorage ??= new Map();
  return holder.__imageBubbleStorage;
}
jest.mock('@/storage', () => ({
  storage: {
    getString: (key: string) => mockStorageValues().get(key),
    set: (key: string, value: string) => mockStorageValues().set(key, value),
  },
}));

jest.mock('@/theme', () => ({
  Radius: { md: 12 },
  Spacing: { xs: 4, sm: 8 },
  Typography: { tinyRegular: {} },
  useTheme: () => ({ colors: { textSecondary: '#666' } }),
}));

const imageMessage = {
  id: 'm1',
  type: 'image',
  imageUrl: 'https://media.example.com/full.jpg',
  imageThumbUrl: 'https://media.example.com/thumb.jpg',
  imageWidth: 100,
  imageHeight: 100,
  time: '10:00',
} as unknown as ChatMessage;

const cachePolicies = () => imageProps.map((props) => props.cachePolicy);

beforeEach(() => {
  imageProps.length = 0;
  viewerModes.length = 0;
});

describe('ImageBubble ephemeral rendering', () => {
  // 这是本次要修的场景：推送冷启动时会话列表还没到，屏幕级判定读成 false。
  // 消息自己带着焚毁秒数，所以仍然必须按阅后即焚渲染 —— 否则原图落盘、
  // 长按可存相册，等列表补齐再翻转已经晚了。
  it('stays ephemeral when the conversation cache has not loaded yet', () => {
    const burning = {
      ...imageMessage,
      burnDurationSec: 30,
    } as unknown as ChatMessage;

    render(
      <ImageBubble message={burning} outgoing={false} selfDestructEnabled={false} />,
    );

    expect(cachePolicies()).not.toContain('memory-disk');
    expect(viewerModes).not.toContain('standard');
    expect(viewerModes).toContain('ephemeral');
  });

  it('renders an ordinary image normally', () => {
    render(
      <ImageBubble
        message={imageMessage}
        outgoing={false}
        selfDestructEnabled={false}
      />,
    );

    expect(cachePolicies()).toContain('memory-disk');
    expect(viewerModes).toContain('standard');
  });

  // 老后端不下发这个字段。此时不能凭空当成「没开焚毁」，仍要听屏幕级判定，
  // 行为与升级前一致。
  it('falls back to the screen-level flag when the message carries no duration', () => {
    render(
      <ImageBubble
        message={imageMessage}
        outgoing={false}
        selfDestructEnabled
      />,
    );

    expect(cachePolicies()).not.toContain('memory-disk');
    expect(viewerModes).toContain('ephemeral');
  });

  // 会话关掉焚毁后服务端会下发 null，那时就该回到普通渲染。
  it('treats an explicit null duration as not ephemeral', () => {
    const notBurning = {
      ...imageMessage,
      burnDurationSec: null,
    } as unknown as ChatMessage;

    render(
      <ImageBubble
        message={notBurning}
        outgoing={false}
        selfDestructEnabled={false}
      />,
    );

    expect(cachePolicies()).toContain('memory-disk');
    expect(viewerModes).toContain('standard');
  });
});

describe('ImageBubble disk cache clearing for disappearing images', () => {
  const clearDiskCache = Image.clearDiskCache as jest.Mock;
  const ephemeral = {
    ...imageMessage,
    burnDurationSec: 30,
  } as unknown as ChatMessage;

  beforeEach(() => {
    clearDiskCache.mockClear();
    mockStorageValues().clear();
  });

  // 原来标记只在内存里,而且拿的是每次冷启动都从 0 重新数的策略编号:每次打开 App、
  // 第一次看到阅后即焚图片就把所有图片的磁盘缓存清空,全部重新下载。
  it('clears once per policy and remembers it across app restarts', async () => {
    const first = render(
      <ImageBubble message={ephemeral} outgoing={false} selfDestructCacheKey="u1|viewer:off|burn:c1@t1" />,
    );
    await waitFor(() => expect(clearDiskCache).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(mockStorageValues().get('chat.imageDiskCacheClearedPolicies')).toContain(
        'u1|viewer:off|burn:c1@t1',
      ),
    );
    first.unmount();

    // 再次进入同一个会话(或冷启动后):标记在存储里,不再清。
    render(
      <ImageBubble message={ephemeral} outgoing={false} selfDestructCacheKey="u1|viewer:off|burn:c1@t1" />,
    );
    await Promise.resolve();
    expect(clearDiskCache).toHaveBeenCalledTimes(1);
  });

  it('honours a marker written before this launch', async () => {
    mockStorageValues().set(
      'chat.imageDiskCacheClearedPolicies',
      JSON.stringify(['u1|viewer:on@2026-09-01|burn:c9@off']),
    );
    render(
      <ImageBubble
        message={ephemeral}
        outgoing={false}
        selfDestructCacheKey="u1|viewer:on@2026-09-01|burn:c9@off"
      />,
    );
    await Promise.resolve();
    expect(clearDiskCache).not.toHaveBeenCalled();
  });

  it('clears again when the policy really changes', async () => {
    const view = render(
      <ImageBubble message={ephemeral} outgoing={false} selfDestructCacheKey="u1|viewer:off|burn:c1@t1" />,
    );
    await waitFor(() => expect(clearDiskCache).toHaveBeenCalledTimes(1));
    // 会话重新开启了焚毁(开启时间变了):此前按普通图片落盘的缓存要清掉。
    view.rerender(
      <ImageBubble message={ephemeral} outgoing={false} selfDestructCacheKey="u1|viewer:off|burn:c1@t2" />,
    );
    await waitFor(() => expect(clearDiskCache).toHaveBeenCalledTimes(2));
  });

  it('never clears for ordinary images', async () => {
    render(
      <ImageBubble message={imageMessage} outgoing={false} selfDestructCacheKey="u1|viewer:off|burn:c1@off" />,
    );
    await Promise.resolve();
    expect(clearDiskCache).not.toHaveBeenCalled();
  });
});
