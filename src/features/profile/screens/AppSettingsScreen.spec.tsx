import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import AppSettingsScreen from './AppSettingsScreen';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';

const mockPush = jest.fn();
const mockLogout = jest.fn();
const mockSwitchAccount = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: () => undefined,
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ logout: mockLogout, switchAccount: mockSwitchAccount, submitting: false }),
}));
jest.mock('@/services/cache/clear-app-cache', () => ({
  getAppCacheSize: () => Promise.resolve(0),
  formatCacheSize: () => '0 B',
}));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = jest.requireActual('react-native');
    return <Text>{`icon:${name}`}</Text>;
  },
}));
jest.mock('@/theme', () => {
  const tokens = jest.requireActual('@/theme/tokens');
  return {
    ...tokens,
    iconForeground: (color: string) => color,
    useTheme: () => ({
      resolvedMode: 'light',
      colors: {
        background: '#f4f5f8', surface: '#fff', surfaceBorder: '#ddd', divider: '#eee', text: '#111',
        textSecondary: '#666', error: '#e5484d', success: '#22c55e', primary: '#6366f1',
        primaryLight: '#eef', white: '#fff',
      },
    }),
  };
});

beforeEach(() => {
  mockPush.mockClear();
  mockLogout.mockClear();
  mockSwitchAccount.mockClear();
});

test('every top-level row leads with its own icon and keeps its e2e locator', () => {
  render(<AppSettingsScreen />);
  for (const icon of ['person-circle-outline', 'shield-checkmark-outline', 'notifications-outline', 'information-circle-outline']) {
    expect(screen.getByText(`icon:${icon}`)).toBeTruthy();
  }
  fireEvent.press(screen.getByTestId(E2E_TEST_IDS.settingsRow('notifications')));
  expect(mockPush).toHaveBeenCalledWith('/(tabs)/profile/settings-notifications');
});

test('a search hit from a sub-page names the page it lives on', () => {
  render(<AppSettingsScreen />);
  fireEvent.changeText(screen.getByPlaceholderText('appSettings.searchPlaceholder'), 'vibration');
  expect(screen.getByText('settingsDetails.notifications.vibration')).toBeTruthy();
  expect(screen.getByText('appSettings.rows.notifications.label')).toBeTruthy();
  expect(screen.queryByText('appSettings.rows.privacy.label')).toBeNull();
});

test('switch account and logout sit in their own action card as full-width rows', () => {
  render(<AppSettingsScreen />);
  fireEvent.press(screen.getByTestId(E2E_TEST_IDS.settingsLogout));
  expect(mockSwitchAccount).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByRole('button', { name: 'settingsPage.logout' }));
  expect(mockLogout).toHaveBeenCalledTimes(1);
  // 退出登录是红字行，不再是一整块实心红按钮。
  expect(screen.queryByText('icon:log-out-outline')).toBeNull();
});
