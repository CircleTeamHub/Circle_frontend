import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { LocationCard } from './location-card';
import type { ChatMessage } from '@/types';

// 这条 spec 只关心「渲染时有没有对第三方发出瓦片请求」，所以把 bubble 依赖的
// 持久化 / i18n / 主题全部顶掉，与 avatar-frame-surfaces.spec 同款。
jest.mock('@/storage', () => ({
  storage: { getString: () => undefined, set: () => {}, remove: () => {} },
  mmkvJsonStorage: {},
}));

const imageSources: unknown[] = [];
jest.mock('expo-image', () => ({
  Image: (props: { source?: unknown }) => {
    imageSources.push(props.source);
    return null;
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: Object.assign(() => null, { glyphMap: {} }),
}));

jest.mock('@/theme', () => ({
  Radius: { md: 12, lg: 16 },
  Spacing: { xs: 4, sm: 8, md: 16, lg: 24 },
  Typography: {
    tiny: {},
    tinyRegular: {},
    small: {},
    bodyRegular: {},
    caption: {},
  },
  useTheme: () => ({
    colors: {
      overlay: 'rgba(0,0,0,.4)',
      primary: '#6200ee',
      receivedBubble: '#eee',
      surface: '#fff',
      text: '#111',
      textSecondary: '#666',
      white: '#fff',
    },
  }),
}));

jest.mock('./shared', () => ({
  CHAT_CARD_PADDING_VERTICAL: 8,
  LOCATION_CARD_WIDTH: 240,
  MessageAvatar: () => null,
}));

const message = {
  id: 'm1',
  type: 'location',
  locationTitle: '中心公园',
  locationAddress: '某市某区某路 1 号',
  locationLatitude: 22.5431,
  locationLongitude: 114.0579,
  time: '10:00',
} as unknown as ChatMessage;

const tileRequests = () =>
  imageSources.filter(
    (source) => typeof source === 'string' && source.includes('tile.openstreetmap.org'),
  );

describe('LocationCard map preview', () => {
  beforeEach(() => {
    imageSources.length = 0;
  });

  // 私聊里的坐标 + 收件人的网络元数据不该因为「消息进了列表」就自动交给 OSM。
  it('requests no third-party map tile just by rendering', () => {
    render(<LocationCard message={message} />);
    expect(tileRequests()).toHaveLength(0);
  });

  it('loads tiles only after the reader explicitly asks for the preview', () => {
    const view = render(<LocationCard message={message} />);
    expect(tileRequests()).toHaveLength(0);

    fireEvent.press(view.getByText('chat.location.showPreview'));

    expect(tileRequests().length).toBeGreaterThan(0);
  });

  it('offers no preview affordance when the message has no usable coordinates', () => {
    const withoutCoordinates = {
      ...message,
      locationLatitude: null,
      locationLongitude: null,
    } as unknown as ChatMessage;

    const view = render(<LocationCard message={withoutCoordinates} />);

    expect(view.queryByText('chat.location.showPreview')).toBeNull();
    expect(tileRequests()).toHaveLength(0);
  });
});
