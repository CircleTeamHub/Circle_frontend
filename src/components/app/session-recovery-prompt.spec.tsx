import { Alert } from 'react-native';
import { render } from '@testing-library/react-native';
import { SessionRecoveryPrompt } from './session-recovery-prompt';

const mockPush = jest.fn();
const mockSetAddingAccount = jest.fn();
let mockAuth = { hasHydrated: true, isAuthenticated: true, refreshUncertain: false, refreshAttemptId: null as string | null, sessionEpoch: 1 };
let mockSwitcher = { addingAccount: false, switching: false, setAddingAccount: mockSetAddingAccount };
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/stores/authStore', () => {
  const useAuthStore = (selector: (state: typeof mockAuth) => unknown) => selector(mockAuth);
  useAuthStore.getState = () => mockAuth;
  return { useAuthStore };
});
jest.mock('@/stores/accountSwitcherStore', () => {
  const useAccountSwitcherStore = (selector: (state: typeof mockSwitcher) => unknown) => selector(mockSwitcher);
  useAccountSwitcherStore.getState = () => mockSwitcher;
  return { useAccountSwitcherStore };
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockAuth = { hasHydrated: true, isAuthenticated: true, refreshUncertain: false, refreshAttemptId: null, sessionEpoch: 1 };
  mockSwitcher = { addingAccount: false, switching: false, setAddingAccount: mockSetAddingAccount };
});

test('ordinary pending rotation does not ask the user to sign in', () => {
  mockAuth.refreshAttemptId = '12345678-1234-4234-8234-123456789abc';
  render(<SessionRecoveryPrompt />);
  expect(Alert.alert).not.toHaveBeenCalled();
});

test('a proactive refresh failure shows an explicit recovery action while retaining the session', () => {
  const screen = render(<SessionRecoveryPrompt />);
  mockAuth.refreshUncertain = true;
  screen.rerender(<SessionRecoveryPrompt />);
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  const [title, message, buttons] = jest.mocked(Alert.alert).mock.calls[0];
  expect(title).toBe('auth.login');
  expect(message).toBe('common.errors.refreshOutcomeUnknown');
  expect(mockAuth.isAuthenticated).toBe(true);
  expect(mockPush).not.toHaveBeenCalled();
  buttons?.find(button => button.text === 'auth.login')?.onPress?.();
  expect(mockSetAddingAccount).toHaveBeenCalledWith(true);
  expect(mockPush).toHaveBeenCalledWith('/(auth)/login');
});

test('canceling recovery preserves the session and does not repeatedly prompt on rerender', () => {
  mockAuth.refreshUncertain = true;
  const screen = render(<SessionRecoveryPrompt />);
  jest.mocked(Alert.alert).mock.calls[0][2]?.find(button => button.style === 'cancel')?.onPress?.();
  screen.rerender(<SessionRecoveryPrompt />);
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(mockAuth.isAuthenticated).toBe(true);
  expect(mockPush).not.toHaveBeenCalled();
});

test('an old prompt cannot navigate after the user has switched sessions', () => {
  mockAuth.refreshUncertain = true;
  render(<SessionRecoveryPrompt />);
  mockAuth = { ...mockAuth, sessionEpoch: 2, refreshUncertain: false };
  jest.mocked(Alert.alert).mock.calls[0][2]?.find(button => button.text === 'auth.login')?.onPress?.();
  expect(mockPush).not.toHaveBeenCalled();
});

test('leaving the recovery login form offers recovery again without clearing the session', () => {
  mockAuth.refreshUncertain = true;
  const screen = render(<SessionRecoveryPrompt />);
  mockSwitcher.addingAccount = true;
  screen.rerender(<SessionRecoveryPrompt />);
  mockSwitcher.addingAccount = false;
  screen.rerender(<SessionRecoveryPrompt />);
  expect(Alert.alert).toHaveBeenCalledTimes(2);
  expect(mockAuth.isAuthenticated).toBe(true);
});

test.each(['addingAccount', 'switching'] as const)('recovery does not interrupt %s', flag => {
  mockAuth.refreshUncertain = true;
  mockSwitcher[flag] = true;
  render(<SessionRecoveryPrompt />);
  expect(Alert.alert).not.toHaveBeenCalled();
});
