import React from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import LoginScreen from './LoginScreen';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';

const mockLogin = jest.fn();
const mockPush = jest.fn();
const mockAuthState: { submitting: boolean; error: string | null } = {
  submitting: false,
  error: null,
};
const mockNetworkState: { isOffline: boolean } = { isOffline: false };

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useLocalSearchParams: () => ({}),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

jest.mock('@/theme', () => {
  const tokens = jest.requireActual<typeof import('@/theme/tokens')>('@/theme/tokens');
  const palettes = jest.requireActual<typeof import('@/theme/colors')>('@/theme/colors');
  return {
    ...tokens,
    ...palettes,
    useTheme: () => ({
      colors: palettes.darkColors,
      resolvedMode: 'dark',
      themeMode: 'dark',
      setThemeMode: jest.fn(),
      toggleTheme: jest.fn(),
    }),
  };
});

jest.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    login: mockLogin,
    submitting: mockAuthState.submitting,
    error: mockAuthState.error,
  }),
}));

jest.mock('@/hooks/use-network-status', () => ({
  useNetworkStatus: () => ({ isOffline: mockNetworkState.isOffline }),
}));

jest.mock('@/hooks/use-reduce-motion', () => ({
  useReduceMotion: () => true,
}));

jest.mock('@/features/auth/components/LoginSky', () => {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return { LoginSky: () => <View testID="login-sky" /> };
});

// AuthInput 里的眼睛图标会异步加载字体并 setState，测试里只会制造 act 警告。
jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthState.submitting = false;
  mockAuthState.error = null;
  mockNetworkState.isOffline = false;
});

test('renders the night-flight login: sky, heading, password form, no slogan', () => {
  render(<LoginScreen />);

  expect(screen.getByTestId(E2E_TEST_IDS.authLoginScreen)).toBeTruthy();
  expect(screen.getByTestId('login-sky')).toBeTruthy();
  expect(screen.getByText('auth.welcomeBack')).toBeTruthy();
  expect(screen.getByText('auth.loginSubtitle')).toBeTruthy();
  expect(screen.getByTestId(E2E_TEST_IDS.authEmailInput)).toBeTruthy();
  expect(screen.getByTestId(E2E_TEST_IDS.authPasswordInput)).toBeTruthy();
  expect(screen.getByText('auth.forgotPassword')).toBeTruthy();
  expect(screen.getByTestId(E2E_TEST_IDS.authSubmit)).toBeTruthy();
  expect(screen.getByText('auth.registerNow')).toBeTruthy();
  expect(screen.queryByText(/让聊天/)).toBeNull();

});

test('submits email or user ID with the password and exposes no alternate login controls', () => {
  render(<LoginScreen />);

  fireEvent.changeText(screen.getByTestId(E2E_TEST_IDS.authEmailInput), 'user_123');
  fireEvent.changeText(screen.getByTestId(E2E_TEST_IDS.authPasswordInput), 'secret');
  fireEvent.press(screen.getByTestId(E2E_TEST_IDS.authSubmit));
  expect(mockLogin).toHaveBeenCalledWith('user_123', 'secret');
  expect(screen.getByPlaceholderText('auth.loginIdentifierPlaceholder')).toBeTruthy();
  expect(screen.queryByTestId('windnote.auth.login.mode.code')).toBeNull();
  expect(screen.queryByTestId('windnote.auth.login.mode.qr')).toBeNull();
  expect(screen.queryByTestId('windnote.auth.login.code-input')).toBeNull();
  expect(screen.queryByTestId('windnote.auth.login.send-code')).toBeNull();
});

test('forgot password opens the reset flow', () => {
  render(<LoginScreen />);

  fireEvent.press(screen.getByText('auth.forgotPassword'));
  expect(mockPush).toHaveBeenCalledWith('/(auth)/forgot-password');
});

test('shows the auth error in the reserved message slot, announces it, and disables submit while submitting', () => {
  const announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockImplementation(() => undefined);
  mockAuthState.error = 'boom';
  mockAuthState.submitting = true;
  render(<LoginScreen />);

  expect(screen.getByText('boom')).toBeTruthy();
  expect(announce).toHaveBeenCalledWith('boom');
  expect(screen.getByTestId(E2E_TEST_IDS.authSubmit)).toBeDisabled();
  announce.mockRestore();
});

test('offline and auth errors resolve to a single bounded status message', () => {
  // 两条提示同时渲染会把保留高度的提示槽撑高，登录键跟着往下跳。
  mockNetworkState.isOffline = true;
  mockAuthState.error = 'boom';
  render(<LoginScreen />);

  // 优先级：登录错误 > 离线提示，只呈现最靠前的那条。
  expect(screen.getByText('boom')).toBeTruthy();
  expect(screen.queryByText('auth.offlineHint')).toBeNull();
  // 长文案要有上界，否则换行照样顶动登录键。
  expect(screen.getByText('boom').props.numberOfLines).toBe(2);
});

test('offline alone still shows the offline hint', () => {
  mockNetworkState.isOffline = true;
  render(<LoginScreen />);

  expect(screen.getByText('auth.offlineHint')).toBeTruthy();
});

test('android relies on the live region instead of announcing twice', () => {
  // 提示槽本身是 accessibilityLiveRegion="polite"：安卓上再主动播一次，
  // 同一句会被念两遍。
  const announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockImplementation(() => undefined);
  const originalOS = Platform.OS;
  Object.defineProperty(Platform, 'OS', {
    value: 'android',
    configurable: true,
  });
  mockAuthState.error = 'boom';

  try {
    render(<LoginScreen />);

    expect(screen.getByText('boom')).toBeTruthy();
    expect(announce).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(Platform, 'OS', {
      value: originalOS,
      configurable: true,
    });
    announce.mockRestore();
  }
});
