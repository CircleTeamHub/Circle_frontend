import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import WalletScreen from './WalletScreen';
import { fetchCoinTransactions, fetchWallet } from '@/services/api/coin';

const longWalletError =
  '积分余额加载失败，请检查网络连接后稍后重试；你的现有积分不会受到影响。';
const mockAuthState = {
  user: { accountId: 'account-123', nickname: 'Test User' },
};
const mockWalletState = { balance: null, version: 0 };
const mockTranslate = (key: string, options?: { defaultValue?: string }) =>
  key === 'profile.wallet.loadError'
    ? longWalletError
    : options?.defaultValue ?? key;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockTranslate,
    i18n: { language: 'zh' },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('react-native-svg', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  const { View: RNView } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement(RNView, null, children),
    Path: () => null,
  };
});

jest.mock('@/components/ui/gradient-cover', () => ({
  GradientCover: () => null,
}));

jest.mock('@/components/ui/nav-header', () => ({
  NavHeader: () => null,
}));

jest.mock('@/hooks/use-network-status', () => ({
  useNetworkStatus: () => ({ isOffline: false }),
}));

jest.mock('@/services/api/coin', () => ({
  fetchWallet: jest.fn(),
  fetchCoinTransactions: jest.fn(),
}));

jest.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (state: typeof mockAuthState) => unknown) =>
    selector(mockAuthState),
}));

jest.mock('@/stores/walletRealtimeStore', () => ({
  useWalletRealtimeStore: (
    selector: (state: typeof mockWalletState) => unknown,
  ) => selector(mockWalletState),
}));

jest.mock('@/theme', () => ({
  Gradients: { memberCard: ['#6200ee', '#7c4dff'] },
  Radius: { md: 12, xl: 24 },
  Spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  Typography: {
    small: {},
    caption: {},
    body: {},
    bodyRegular: {},
    h3: {},
  },
  useTheme: () => ({
    colors: {
      background: '#ffffff',
      surface: '#f5f5f5',
      text: '#111111',
      textSecondary: '#666666',
      error: '#cc0000',
      success: '#008800',
    },
  }),
}));

const mockFetchWallet = fetchWallet as jest.MockedFunction<typeof fetchWallet>;
const mockFetchCoinTransactions =
  fetchCoinTransactions as jest.MockedFunction<typeof fetchCoinTransactions>;

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchCoinTransactions.mockResolvedValue([]);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('a long balance error remains complete and outside the clipped card at narrow width', async () => {
  mockFetchWallet.mockRejectedValue(new Error('offline'));

  render(
    <View style={{ width: 320 }}>
      <WalletScreen />
    </View>,
  );

  await waitFor(() =>
    expect(screen.getByTestId('wallet-balance-error')).toBeTruthy(),
  );

  const card = screen.getByTestId('wallet-balance-card');
  const error = screen.getByTestId('wallet-balance-error');
  expect(card.findAllByProps({ testID: 'wallet-balance-error' })).toHaveLength(0);
  expect(error.props.children).toBe(longWalletError);
  expect(error.props.numberOfLines).toBeUndefined();
  expect(StyleSheet.flatten(error.props.style).position).not.toBe('absolute');
});
