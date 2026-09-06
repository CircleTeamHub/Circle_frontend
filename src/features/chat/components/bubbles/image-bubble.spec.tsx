import React from 'react';
import { render } from '@testing-library/react-native';
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
