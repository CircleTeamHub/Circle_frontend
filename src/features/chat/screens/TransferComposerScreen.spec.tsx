import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import TransferComposerScreen from './TransferComposerScreen';
import { fetchWallet, sendCoinGift } from '@/services/api/coin';
import { ApiError } from '@/services/api/api-error';

const mockStorageValues = new Map<string, string>();
const mockRouter = { back: jest.fn() };
let mockKeySequence = 0;

jest.mock('@/storage', () => ({
  storage: {
    getString: (key: string) => mockStorageValues.get(key),
    set: (key: string, value: string) => mockStorageValues.set(key, value),
    remove: (key: string) => mockStorageValues.delete(key),
  },
}));
jest.mock('@/utils/idempotency-key', () => ({
  generateIdempotencyKey: () => `key-${++mockKeySequence}`,
}));
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({ user: { id: 'me' } }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ recipientId: 'friend-1', recipientName: 'Friend' }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/keyboard-avoiding-container', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    KeyboardAvoidingContainer: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
  };
});
jest.mock('@/components/ui/keyboard-dismiss', () => ({ keyboardDismissOnDragProps: {} }));
jest.mock('@/theme', () => ({
  useTheme: () => ({ colors: {} }),
  Radius: {},
  Spacing: {},
  Typography: {},
}));
jest.mock('@/services/api/coin', () => ({
  fetchWallet: jest.fn(),
  sendCoinGift: jest.fn(),
}));
jest.mock('@/services/api/credit-policy', () => ({
  getLocalLowCreditDecision: () => null,
  getCreditPolicyMessage: () => '',
}));
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error && 'errorCode' in error && error.errorCode
      ? `serverErrors.${String(error.errorCode)}`
      : fallback,
}));

async function sendTransfer() {
  render(<TransferComposerScreen />);
  await waitFor(() => expect(screen.getByText(/chat\.transfer\.currentBalancePrefix/)).toBeTruthy());
  fireEvent.changeText(screen.getByPlaceholderText('0'), '10');
  fireEvent.changeText(screen.getByPlaceholderText('chat.transfer.messagePlaceholder'), 'dinner');
  fireEvent.press(screen.getByText('chat.transfer.submit'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
}

function sentKeys(): string[] {
  return jest.mocked(sendCoinGift).mock.calls.map(([, options]) => options?.idempotencyKey ?? '');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStorageValues.clear();
  mockKeySequence = 0;
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(fetchWallet).mockResolvedValue({ balance: 100 } as never);
});

test('a timed-out transfer warns it may have gone through and reuses its key after re-entering', async () => {
  jest.mocked(sendCoinGift).mockRejectedValue(
    new ApiError('timeout', { status: 0, failureKind: 'timeout' }),
  );

  await sendTransfer();
  expect(Alert.alert).toHaveBeenCalledWith(
    'chat.transfer.outcomeUnknownTitle',
    'chat.transfer.outcomeUnknownMessage',
  );
  // The balance is reloaded so the user can see whether it was charged.
  await waitFor(() => expect(fetchWallet).toHaveBeenCalledTimes(2));

  screen.unmount();
  jest.mocked(Alert.alert).mockClear();
  await sendTransfer();

  expect(sentKeys()).toEqual(['key-1', 'key-1']);
  expect(sendCoinGift).toHaveBeenLastCalledWith(
    { recipientId: 'friend-1', amount: 10, message: 'dinner' },
    { idempotencyKey: 'key-1' },
  );
});

test('a transfer still being processed keeps its key too', async () => {
  jest.mocked(sendCoinGift).mockRejectedValue(
    new ApiError('busy', { status: 409, errorCode: 'IDEMPOTENCY_IN_PROGRESS' }),
  );

  await sendTransfer();
  expect(Alert.alert).toHaveBeenCalledWith(
    'chat.transfer.outcomeUnknownTitle',
    'chat.transfer.outcomeUnknownMessage',
  );
  screen.unmount();
  await sendTransfer();

  expect(sentKeys()).toEqual(['key-1', 'key-1']);
});

test('a definitive rejection drops the key, so the next attempt is a new transfer', async () => {
  jest.mocked(sendCoinGift).mockRejectedValue(
    new ApiError('no', { status: 400, errorCode: 'COIN_NOT_FRIEND' }),
  );

  await sendTransfer();
  expect(Alert.alert).toHaveBeenCalledWith(
    'chat.transfer.failedTitle',
    'serverErrors.COIN_NOT_FRIEND',
  );
  screen.unmount();
  await sendTransfer();

  expect(sentKeys()).toEqual(['key-1', 'key-2']);
});

test('a successful transfer drops the key and leaves the composer', async () => {
  jest.mocked(sendCoinGift).mockResolvedValue(undefined);

  render(<TransferComposerScreen />);
  await waitFor(() => expect(screen.getByText(/chat\.transfer\.currentBalancePrefix/)).toBeTruthy());
  fireEvent.changeText(screen.getByPlaceholderText('0'), '10');
  fireEvent.press(screen.getByText('chat.transfer.submit'));

  await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
  expect(mockStorageValues.size).toBe(0);
});
