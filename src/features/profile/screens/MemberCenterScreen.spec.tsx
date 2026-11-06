import React from 'react';
import { render, screen } from '@testing-library/react-native';
import MemberCenterScreen from './MemberCenterScreen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/components/ui/nav-header', () => {
  const { Text } = jest.requireActual('react-native');
  return { NavHeader: ({ title }: { title: string }) => <Text>{title}</Text> };
});
jest.mock('@/theme', () => ({
  Spacing: { xl: 32 },
  Typography: { h3: {} },
  useTheme: () => ({ colors: { background: '#fff', textSecondary: '#666' } }),
}));

test('only says the membership feature is not open yet', () => {
  render(<MemberCenterScreen />);

  expect(screen.getByText('profile.membership.title')).toBeTruthy();
  expect(screen.getByText('profile.membership.marketing.title')).toBeTruthy();
  // 标题栏 + 一句提示,其余套餐、权益、客服入口都不再出现。
  expect(screen.queryAllByText(/./)).toHaveLength(2);
});
