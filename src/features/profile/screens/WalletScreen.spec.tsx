import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
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

// 真实 token 与浅色色板，只替换掉会牵出原生存储的 ThemeProvider。
jest.mock('@/theme', () => ({
  ...jest.requireActual('@/theme/tokens'),
  useTheme: () => ({ colors: jest.requireActual('@/theme/colors').lightColors }),
}));

const mockRouter = { push: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
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

test('the invite shortcut opens the referral page and recharge stays disabled', async () => {
  mockFetchWallet.mockResolvedValue({ balance: 120 } as Awaited<ReturnType<typeof fetchWallet>>);
  render(<WalletScreen />);

  fireEvent.press(await screen.findByText('邀请有礼'));
  expect(mockRouter.push).toHaveBeenCalledWith('/(tabs)/profile/share');

  const recharge = screen.getByText('积分充值');
  let tile = recharge.parent;
  while (tile && !tile.props.accessibilityState) tile = tile.parent;
  expect(tile?.props.accessibilityState).toEqual({ disabled: true });
  expect(screen.getByText('积分购买暂未开放。')).toBeTruthy();
});

test('history groups rows by month and a failed load can be retried', async () => {
  mockFetchWallet.mockResolvedValue({ balance: 120 } as Awaited<ReturnType<typeof fetchWallet>>);
  mockFetchCoinTransactions.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([
    {
      id: 'tx-1',
      type: 'REFERRAL_REWARD',
      amount: 50,
      balance: 120,
      note: null,
      relatedID: null,
      createdAt: '2026-10-20T08:30:00.000Z',
    },
    {
      id: 'tx-2',
      type: 'GIFT_SENT',
      amount: -20,
      balance: 70,
      note: null,
      relatedID: null,
      createdAt: '2026-09-02T08:30:00.000Z',
    },
  ]);
  render(<WalletScreen />);

  fireEvent.press(await screen.findByText('重试'));

  expect(await screen.findByText('邀请好友奖励')).toBeTruthy();
  expect(screen.getByText('赠送积分')).toBeTruthy();
  expect(mockFetchCoinTransactions).toHaveBeenCalledTimes(2);
  // 两个月份各一个分组标题；收入带 + 号，支出不带。
  expect(screen.getAllByText(/2026/)).toHaveLength(2);
  expect(screen.getByText('+50')).toBeTruthy();
  expect(screen.getByText('-20')).toBeTruthy();
});

test('the card formats the balance and the eye button hides it', async () => {
  mockFetchWallet.mockResolvedValue({ balance: 12800 } as Awaited<ReturnType<typeof fetchWallet>>);
  render(<WalletScreen />);

  expect(await screen.findByText('12,800')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('隐藏余额'));
  expect(screen.queryByText('12,800')).toBeNull();
  expect(screen.getByText('••••••')).toBeTruthy();

  fireEvent.press(screen.getByLabelText('显示余额'));
  expect(screen.getByText('12,800')).toBeTruthy();
});
