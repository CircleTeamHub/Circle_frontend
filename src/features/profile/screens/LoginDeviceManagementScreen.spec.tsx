import React from 'react';
import { render, screen } from '@testing-library/react-native';
import LoginDeviceManagementScreen from './LoginDeviceManagementScreen';
import { fetchAuthSessions } from '@/services/api/auth';

const mockT = (key: string) => key;
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = jest.requireActual('react-native');
    return <Text>{`icon:${name}`}</Text>;
  },
}));
jest.mock('@/services/api/auth', () => ({
  fetchAuthSessions: jest.fn(),
  logoutOtherSessions: jest.fn(),
  revokeAuthSession: jest.fn(),
}));
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock('@/services/auth/session', () => ({ clearLocalSession: jest.fn() }));
jest.mock('@/theme', () => {
  const tokens = jest.requireActual('@/theme/tokens');
  return {
    ...tokens,
    useTheme: () => ({
      colors: {
        background: '#f4f5f8', surface: '#fff', divider: '#eee', text: '#111', textSecondary: '#666',
        error: '#e5484d', primary: '#6366f1', primaryLight: '#eef', iconAccent: '#6366f1',
        white: '#fff', surfaceBorder: '#ddd',
      },
    }),
  };
});

const base = { trustedOnly: false, ip: null, createdAt: '', expiredAt: '', lastUsedAt: '2026-11-01T08:00:00.000Z' };

test('the current device is listed first and every device gets a fitting icon', async () => {
  jest.mocked(fetchAuthSessions).mockResolvedValue([
    { ...base, id: 'web', isCurrent: false, deviceName: null, userAgent: 'Mozilla/5.0 (Macintosh) Chrome/130' },
    { ...base, id: 'me', isCurrent: true, deviceName: 'iPhone 17 Pro', userAgent: null },
  ]);
  render(<LoginDeviceManagementScreen />);

  const titles = await screen.findAllByText(/iPhone 17 Pro|Mozilla/);
  expect(titles.map((node) => node.props.children)).toEqual([
    'iPhone 17 Pro',
    'Mozilla/5.0 (Macintosh) Chrome/130',
  ]);
  expect(screen.getByText('icon:phone-portrait-outline')).toBeTruthy();
  expect(screen.getByText('icon:laptop-outline')).toBeTruthy();
  expect(screen.getByText('settingsDetails.accountSecurity.deviceManagement.current')).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'settingsDetails.accountSecurity.deviceManagement.remove' }),
  ).toBeTruthy();
});
