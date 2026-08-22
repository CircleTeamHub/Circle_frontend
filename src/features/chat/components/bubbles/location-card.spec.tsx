import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { LocationCard } from './location-card';
import { resolvePlace } from '@/features/location/services/reverse-geocode';
import type { ChatMessage } from '@/types';

// 这条 spec 只关心「渲染时有没有对第三方发出瓦片请求」，所以把 bubble 依赖的
// 持久化 / i18n / 主题全部顶掉，与 avatar-frame-surfaces.spec 同款。
jest.mock('@/storage', () => ({
  storage: { getString: () => undefined, set: () => {}, remove: () => {} },
  mmkvJsonStorage: {},
}));

const imageSources: unknown[] = [];
jest.mock('expo-image', () => {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Image: (props: { source?: unknown }) => {
      imageSources.push(props.source);
      return <View testID="map-tile" />;
    },
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: Object.assign(() => null, { glyphMap: {} }),
}));

jest.mock('@/theme', () => ({
  Radius: { md: 12, lg: 16 },
  Spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  Typography: {
    tiny: {},
    tinyRegular: {},
    small: {},
    bodyRegular: {},
    caption: {},
  },
  useTheme: () => ({
    resolvedMode: 'light',
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
  LOCATION_CARD_WIDTH: 252,
  MessageAvatar: () => null,
}));

jest.mock('@/features/location/services/reverse-geocode', () => ({
  resolvePlace: jest.fn(),
}));

const mockResolvePlace = resolvePlace as jest.MockedFunction<
  typeof resolvePlace
>;

const REVEAL_LABEL = '轻点显示地图';

const message = {
  id: 'm1',
  type: 'location',
  locationTitle: '中心公园',
  locationAddress: '某市某区某路 1 号',
  locationLatitude: 22.5431,
  locationLongitude: 114.0579,
  time: '10:00',
} as unknown as ChatMessage;

// 反查地址失败 / web 上 expo-location 没有 reverseGeocodeAsync 时的样子。
const coordinateOnlyMessage = {
  ...message,
  locationTitle: '我的位置',
  locationAddress: '37.32698, -121.88435',
  locationLatitude: 37.32698,
  locationLongitude: -121.88435,
} as unknown as ChatMessage;

// 底图瓦片的第三方主机（OSM 数据 + CARTO 渲染）。这条 spec 关心的就是
// 「有没有在用户没同意前把坐标交给它」。
const BASEMAP_HOST = 'basemaps.cartocdn.com';

const tileRequests = () =>
  imageSources.filter(
    (source) => typeof source === 'string' && source.includes(BASEMAP_HOST),
  );

beforeEach(() => {
  imageSources.length = 0;
  mockResolvePlace.mockReset();
  mockResolvePlace.mockResolvedValue(null);
});

describe('LocationCard map preview', () => {
  // 私聊里的坐标 + 收件人的网络元数据不该因为「消息进了列表」就自动交给 OSM。
  it('requests no third-party map tile just by rendering', () => {
    render(<LocationCard message={message} />);
    expect(tileRequests()).toHaveLength(0);
  });

  it('loads tiles only after the reader explicitly asks for the preview', () => {
    const view = render(<LocationCard message={message} />);
    expect(tileRequests()).toHaveLength(0);

    fireEvent.press(view.getByText(REVEAL_LABEL));

    expect(tileRequests().length).toBeGreaterThan(0);
  });

  it('offers no preview affordance when the message has no usable coordinates', () => {
    const withoutCoordinates = {
      ...message,
      locationLatitude: null,
      locationLongitude: null,
    } as unknown as ChatMessage;

    const view = render(<LocationCard message={withoutCoordinates} />);

    expect(view.queryByText(REVEAL_LABEL)).toBeNull();
    expect(tileRequests()).toHaveLength(0);
  });

  // 自己发的位置不该退化成一块灰板：坐标是本人刚在选点页选的，那一页已经拉过
  // 一整屏 OSM 瓦片了，隐私门禁在这一侧没有任何东西可保护。
  it('renders an outgoing location on the map immediately', () => {
    render(<LocationCard message={message} outgoing />);

    expect(screen.queryByText(REVEAL_LABEL)).toBeNull();
    expect(tileRequests().length).toBeGreaterThan(0);
  });
});

describe('LocationCard address resolution', () => {
  it('replaces a coordinate-only address with the resolved place', async () => {
    mockResolvePlace.mockResolvedValue({
      title: 'San Jose City Hall',
      address: '200 E Santa Clara St, San Jose, CA 95113, USA',
    });

    render(<LocationCard message={coordinateOnlyMessage} outgoing />);

    expect(screen.getByText('37.32698, -121.88435')).toBeTruthy();
    await waitFor(() => {
      expect(
        screen.getByText('200 E Santa Clara St, San Jose, CA 95113, USA'),
      ).toBeTruthy();
    });
    expect(mockResolvePlace).toHaveBeenCalledWith(37.32698, -121.88435);
    // 标题是用户自己的表达，反查回来的路名不许盖掉。
    expect(screen.getByText('我的位置')).toBeTruthy();
  });

  it('shows a real address as-is and never triggers a lookup', () => {
    render(<LocationCard message={message} outgoing />);

    expect(screen.getByText('某市某区某路 1 号')).toBeTruthy();
    expect(mockResolvePlace).not.toHaveBeenCalled();
  });

  // 反查和瓦片共用同一道隐私门禁：没展开地图就一个第三方请求都不发。
  it('asks for nothing while a received location stays collapsed', () => {
    render(<LocationCard message={coordinateOnlyMessage} />);

    expect(mockResolvePlace).not.toHaveBeenCalled();
  });

  it('resolves the address once the reader reveals the map', async () => {
    mockResolvePlace.mockResolvedValue({
      title: '民田路',
      address: '民田路, 福田区, 深圳市, 中国',
    });

    const view = render(<LocationCard message={coordinateOnlyMessage} />);
    fireEvent.press(view.getByText(REVEAL_LABEL));

    await waitFor(() => {
      expect(screen.getByText('民田路, 福田区, 深圳市, 中国')).toBeTruthy();
    });
  });

  it('leaves the coordinates in place when the lookup fails', async () => {
    mockResolvePlace.mockResolvedValue(null);

    render(<LocationCard message={coordinateOnlyMessage} outgoing />);

    await waitFor(() => expect(mockResolvePlace).toHaveBeenCalled());
    expect(screen.getByText('37.32698, -121.88435')).toBeTruthy();
  });

  it('never looks up a location without usable coordinates', () => {
    const withoutCoordinates = {
      ...coordinateOnlyMessage,
      locationLatitude: null,
      locationLongitude: null,
    } as unknown as ChatMessage;

    render(<LocationCard message={withoutCoordinates} outgoing />);

    expect(mockResolvePlace).not.toHaveBeenCalled();
  });
});
