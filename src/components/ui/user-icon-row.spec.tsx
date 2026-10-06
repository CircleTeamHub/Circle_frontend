import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { UserIconRow } from './user-icon-row';
import type { DisplayIcon } from '@/types';

jest.mock('expo-image', () => {
  const { Pressable, View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Image: ({ onError }: { onError?: () => void }) => (
      <Pressable testID="badge-image" onPress={onError}>
        <View />
      </Pressable>
    ),
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
  getSystemBadgeAsset: (() => {
    const asset = { uri: 'badge' };
    return () => asset;
  })(),
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
