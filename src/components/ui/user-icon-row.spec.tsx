import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { UserIconBadge, UserIconRow } from './user-icon-row';
import type { DisplayIcon } from '@/types';

const mockImages: { source?: unknown; style?: unknown; onError?: () => void }[] = [];
const mockBadgeAssets = new Map<string, { uri: string }>();
const mockGetSystemBadgeAsset = jest.fn<{ uri: string } | null, [DisplayIcon]>();

jest.mock('expo-image', () => {
  const { Pressable, View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Image: (props: { source?: unknown; style?: unknown; onError?: () => void }) => {
      mockImages.push(props);
      return <Pressable testID="badge-image" onPress={props.onError}><View /></Pressable>;
    },
  };
});

jest.mock('@expo/vector-icons', () => {
  const { Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Ionicons: Object.assign(
      ({ name }: { name: string }) => <Text>{name}</Text>,
      {
        glyphMap: { 'sparkles-outline': 1 },
      },
    ),
  };
});

jest.mock('@/theme', () => ({
  Radius: { full: 999 },
  Spacing: { sm: 8 },
  useTheme: () => ({
    colors: {
      surface: '#fff',
      surfaceBorder: '#ddd',
      text: '#111',
      textSecondary: '#666',
      white: '#fff',
    },
  }),
}));

jest.mock('./user-badge-assets', () => ({
  getSystemBadgeAsset: (icon: DisplayIcon) => mockGetSystemBadgeAsset(icon),
  getSystemBadgeArtBox: () => mockArtBox,
}));

let mockArtBox = { visibleRatio: 1, offsetX: 0, offsetY: 0 };

const vipIcon = (systemVariant: string, sortOrder: number): DisplayIcon => ({
  id: 'system:VIP3',
  type: 'SYSTEM',
  title: '钻石会员',
  imageUrl: null,
  fallbackIconName: 'diamond',
  systemKey: 'VIP',
  systemVariant,
  sortOrder,
});

beforeEach(() => {
  mockArtBox = { visibleRatio: 1, offsetX: 0, offsetY: 0 };
  mockImages.length = 0;
  mockBadgeAssets.clear();
  mockGetSystemBadgeAsset.mockReset().mockImplementation((icon) => {
    const key = icon.systemVariant ?? icon.id;
    if (!mockBadgeAssets.has(key)) mockBadgeAssets.set(key, { uri: key });
    return mockBadgeAssets.get(key)!;
  });
});

test('renders one badge when historical VIP selections resolve to the same identity', () => {
  render(
    <UserIconRow
      icons={[vipIcon('VIP3', 0), vipIcon('VIP3', 1), vipIcon('VIP3', 2)]}
    />,
  );

  // 名字只作读屏标签,徽章下面不画文字。
  expect(screen.getAllByLabelText('钻石会员')).toHaveLength(1);
  expect(screen.queryByText('钻石会员')).toBeNull();
});

test('falls back to a visible vector badge when local artwork fails to load', () => {
  render(<UserIconRow icons={[vipIcon('VIP2', 0)]} />);

  fireEvent.press(screen.getByTestId('badge-image'));

  expect(screen.getByText('sparkles-outline')).toBeTruthy();
});

test('an old system artwork error cannot hide the replacement badge', () => {
  const view = render(<UserIconBadge icon={vipIcon('VIP2', 0)} />);
  const oldError = mockImages[mockImages.length - 1].onError!;
  view.rerender(<UserIconBadge icon={vipIcon('VIP3', 0)} />);
  act(() => oldError());
  expect(screen.getByTestId('badge-image')).toBeTruthy();
  expect(mockImages[mockImages.length - 1].source).toEqual({ uri: 'VIP3' });
  expect(screen.queryByText('sparkles-outline')).toBeNull();
});

test('an old circle image error cannot hide the replacement URL', () => {
  const circle: DisplayIcon = { id: 'circle-a', type: 'CIRCLE', title: 'A', imageUrl: 'https://example.test/a.png', circleId: 'a', fallbackIconName: 'sparkles-outline', sortOrder: 0 };
  const view = render(<UserIconBadge icon={circle} />);
  const oldError = mockImages[mockImages.length - 1].onError!;
  view.rerender(<UserIconBadge icon={{ ...circle, id: 'circle-b', circleId: 'b', imageUrl: 'https://example.test/b.png' }} />);
  act(() => oldError());
  expect(mockImages[mockImages.length - 1].source).toEqual({ uri: 'https://example.test/b.png' });
  expect(screen.getByTestId('badge-image')).toBeTruthy();
  fireEvent.press(screen.getByTestId('badge-image'));
  expect(screen.getByText('sparkles-outline')).toBeTruthy();
});

test('a system badge without local artwork still displays its custom image', () => {
  mockGetSystemBadgeAsset.mockReturnValue(null);
  render(<UserIconBadge icon={{ ...vipIcon('VIP2', 0), imageUrl: 'https://example.test/custom.png' }} />);
  expect(screen.getByTestId('badge-image')).toBeTruthy();
  expect(mockImages[mockImages.length - 1].source).toEqual({ uri: 'https://example.test/custom.png' });
});

type Transform = { scale?: number; translateX?: number; translateY?: number }[];
const badgeTransform = (): Transform | undefined =>
  ([mockImages[0].style].flat(3).find(
    (item): item is object => typeof item === 'object' && item !== null && 'transform' in item,
  ) as { transform: Transform } | undefined)?.transform;

// 系统徽章的可见部分(去掉 PNG 透明边)要和同档的圆形圈子徽章一样大:最小档圆形外圈 28,
// 外壳 30,可见比例 0.73 的素材就要放大 28 / (30 × 0.73) 倍。
test('a small compact system badge is scaled so its visible art matches the circle badge', () => {
  mockArtBox = { visibleRatio: 0.73, offsetX: 0, offsetY: 0 };
  render(<UserIconBadge icon={vipIcon('VIP1', 0)} compact compactSize="small" />);
  const scale = badgeTransform()?.find((item) => item.scale !== undefined)?.scale;
  expect(scale).toBeCloseTo(28 / (30 * 0.73), 3);
});

// 画面不在素材正中(比如偏上 3.4%):先挪回外壳中心再放大,和圆形徽章圆心对齐。
test("a badge whose art sits off-centre is moved so its centre meets the circle badge's", () => {
  mockArtBox = { visibleRatio: 0.73, offsetX: 0, offsetY: -0.034 };
  render(<UserIconBadge icon={vipIcon('VIP1', 0)} compact compactSize="small" />);
  const transform = badgeTransform()!;
  const scale = 28 / (30 * 0.73);
  // 平移写在缩放前面,数值就是放大后的实际像素。
  expect(transform.findIndex((item) => item.translateY !== undefined)).toBeLessThan(
    transform.findIndex((item) => item.scale !== undefined),
  );
  expect(transform.find((item) => item.translateY !== undefined)?.translateY).toBeCloseTo(0.034 * 30 * scale, 1);
});

test('artwork that fills its canvas exactly at circle size is left unscaled', () => {
  mockArtBox = { visibleRatio: 40 / 52, offsetX: 0, offsetY: 0 };
  render(<UserIconBadge icon={vipIcon('VIP1', 0)} />);
  expect(badgeTransform()).toBeUndefined();
});
