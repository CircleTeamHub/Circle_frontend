import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { UserIconRow } from './user-icon-row';
import type { DisplayIcon } from '@/types';

jest.mock('expo-image', () => {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return { Image: () => <View testID="badge-image" /> };
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
  getSystemBadgeAsset: () => ({ uri: 'badge' }),
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
