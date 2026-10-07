import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { UserIconBadge, UserIconRow } from './user-icon-row';
import type { DisplayIcon } from '@/types';

const mockImages: { source?: unknown; onError?: () => void }[] = [];
const mockBadgeAssets = new Map<string, { uri: string }>();
const mockGetSystemBadgeAsset = jest.fn<{ uri: string } | null, [DisplayIcon]>();

jest.mock('expo-image', () => {
  const { Pressable, View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Image: (props: { source?: unknown; onError?: () => void }) => {
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
  getSystemBadgeVisualScale: () => 1,
  getSystemBadgeVisualTranslateY: () => 0,
}));

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

  expect(screen.getAllByText('钻石会员')).toHaveLength(1);
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
