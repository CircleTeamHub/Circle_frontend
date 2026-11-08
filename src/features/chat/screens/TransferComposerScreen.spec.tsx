import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import TransferComposerScreen from './TransferComposerScreen';
import { fetchWallet, sendCoinGift } from '@/services/api/coin';

const mockRouter = { back: jest.fn() };
let mockFocused = true;

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useNavigation: () => ({ isFocused: () => mockFocused }),
  useLocalSearchParams: () => ({
    recipientId: '11111111-1111-4111-8111-111111111111',
    recipientName: '对方',
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/keyboard-avoiding-container', () => ({
  KeyboardAvoidingContainer: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/services/api/coin', () => ({
  fetchWallet: jest.fn(),
  sendCoinGift: jest.fn(),
}));
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock('@/services/api/credit-policy', () => ({
  getCreditPolicyMessage: () => null,
  getLocalLowCreditDecision: () => null,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockFocused = true;
  jest.mocked(fetchWallet).mockResolvedValue({ balance: 100 } as never);
});

async function submitTransfer() {
  render(<TransferComposerScreen />);
  await screen.findByText('chat.transfer.submit');
  fireEvent.changeText(screen.getByPlaceholderText('0'), '10');
  await act(async () => {
    fireEvent.press(screen.getByText('chat.transfer.submit'));
  });
}

test('a successful transfer returns to the chat', async () => {
  jest.mocked(sendCoinGift).mockResolvedValue(undefined as never);

  await submitTransfer();

  expect(sendCoinGift).toHaveBeenCalledTimes(1);
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

// 回归:「转账中...」时用户先按了返回,页面已经关掉;请求成功后这页又执行一次 back,
// 在半屏里把半屏关掉、在完整聊天页里把聊天页关掉。
test('a transfer that succeeds after the user already went back does not go back again', async () => {
  let resolveGift: () => void = () => {};
  jest.mocked(sendCoinGift).mockReturnValue(
    new Promise<void>((resolve) => {
      resolveGift = resolve;
    }) as never,
  );

  await submitTransfer();
  expect(sendCoinGift).toHaveBeenCalledTimes(1);
  mockFocused = false;
  await act(async () => {
    resolveGift();
  });

  expect(mockRouter.back).not.toHaveBeenCalled();
});
