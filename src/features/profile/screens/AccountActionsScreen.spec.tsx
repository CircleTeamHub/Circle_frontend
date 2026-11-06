import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import ChangeEmailScreen from './ChangeEmailScreen';
import CancelAccountScreen from './CancelAccountScreen';
import { changeEmail, deleteAccount, requestEmailChange } from '@/services/api/auth';
import { clearLocalSession } from '@/services/auth/session';

const mockReplace = jest.fn();
const mockAuth = { sessionEpoch: 1, user: { id: 'user-a', accountId: 'ACCOUNT-A', email: 'old@example.com' } as { id: string; accountId: string; email: string } | null };
const mockT = (key: string) => key;
jest.mock('expo-router', () => ({ router: { replace: (...args: unknown[]) => mockReplace(...args) } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: Object.assign((select: (state: typeof mockAuth) => unknown) => select(mockAuth), { getState: () => mockAuth }) }));
jest.mock('@/theme', () => ({ ...jest.requireActual('@/theme/tokens'), useTheme: () => ({ colors: {} }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 44, bottom: 34 }) }));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/components/ui/keyboard-avoiding-container', () => ({ KeyboardAvoidingContainer: jest.requireActual('react-native').View }));
jest.mock('@/components/ui/auth-input', () => {
  const { TextInput, View } = jest.requireActual('react-native');
  return { AuthInput: ({ rightElement, ...props }: Record<string, unknown>) => <View><TextInput {...props} />{rightElement as React.ReactNode}</View> };
});
jest.mock('@/services/api/auth', () => ({ changeEmail: jest.fn(), deleteAccount: jest.fn(), requestEmailChange: jest.fn() }));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_error: unknown, fallback: string) => fallback }));
jest.mock('@/services/auth/session', () => ({ clearLocalSession: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockAuth.sessionEpoch = 1;
  mockAuth.user = { id: 'user-a', accountId: 'ACCOUNT-A', email: 'old@example.com' };
  jest.mocked(requestEmailChange).mockResolvedValue(undefined);
  jest.mocked(changeEmail).mockResolvedValue(undefined);
  jest.mocked(deleteAccount).mockResolvedValue(undefined);
  jest.mocked(clearLocalSession).mockImplementation(async () => { mockAuth.user = null; mockAuth.sessionEpoch += 1; });
});
afterEach(() => { jest.useRealTimers(); });

function fillEmail() {
  fireEvent.changeText(screen.getByPlaceholderText('settingsDetails.changeEmail.newEmail'), 'new@example.com');
  fireEvent.changeText(screen.getByPlaceholderText('settingsDetails.changeEmail.password'), 'current-password');
  fireEvent.changeText(screen.getByPlaceholderText('settingsDetails.changeEmail.code'), '123456');
}
function confirmDeletion() {
  const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
  act(() => { buttons?.find(button => button.style === 'destructive')?.onPress?.(); });
}

test('email send validates address, current password, and a different mailbox', () => {
  render(<ChangeEmailScreen />);
  fireEvent.press(screen.getByText('settingsDetails.changeEmail.sendCode'));
  expect(requestEmailChange).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByPlaceholderText('settingsDetails.changeEmail.newEmail'), 'new@example.com');
  fireEvent.press(screen.getByText('settingsDetails.changeEmail.sendCode'));
  expect(screen.getByText('settingsDetails.changeEmail.passwordRequired')).toBeTruthy();
  fillEmail();
  fireEvent.changeText(screen.getByPlaceholderText('settingsDetails.changeEmail.newEmail'), ' OLD@Example.com ');
  fireEvent.press(screen.getByText('settingsDetails.changeEmail.sendCode'));
  expect(screen.getByText('settingsDetails.changeEmail.sameEmail')).toBeTruthy();
  expect(requestEmailChange).not.toHaveBeenCalled();
});

test('sending is single flight with cooldown, and correcting the new address resets its code', async () => {
  let resolve!: () => void;
  jest.mocked(requestEmailChange).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  render(<ChangeEmailScreen />);
  fillEmail();
  const send = screen.getByText('settingsDetails.changeEmail.sendCode');
  act(() => { fireEvent.press(send); fireEvent.press(send); });
  expect(requestEmailChange).toHaveBeenCalledTimes(1);
  await act(async () => { resolve(); });
  expect(screen.getByText('settingsDetails.changeEmail.sendAgain')).toBeTruthy();
  fireEvent.changeText(screen.getByPlaceholderText('settingsDetails.changeEmail.newEmail'), 'correct@example.com');
  expect(screen.getByPlaceholderText('settingsDetails.changeEmail.code').props.value).toBe('');
  expect(screen.getByText('settingsDetails.changeEmail.sendCode')).toBeTruthy();
});

test('six digit code is required and a successful change clears only the captured session', async () => {
  render(<ChangeEmailScreen />);
  fillEmail();
  fireEvent.changeText(screen.getByPlaceholderText('settingsDetails.changeEmail.code'), '1234');
  fireEvent.press(screen.getByText('settingsDetails.changeEmail.submit'));
  expect(changeEmail).not.toHaveBeenCalled();
  expect(screen.getByText('settingsDetails.changeEmail.invalidCode')).toBeTruthy();
  fireEvent.changeText(screen.getByPlaceholderText('settingsDetails.changeEmail.code'), '123456');
  fireEvent.press(screen.getByText('settingsDetails.changeEmail.submit'));
  await waitFor(() => expect(clearLocalSession).toHaveBeenCalledWith(1, { reason: 'email-change', userInitiated: true }));
  expect(changeEmail).toHaveBeenCalledWith({ email: 'new@example.com', password: 'current-password', code: '123456' });
  expect(mockReplace).toHaveBeenCalledWith('/(auth)/login');
});

test('failed email sends and saves keep the session and show localized failures', async () => {
  jest.mocked(requestEmailChange).mockRejectedValueOnce(new Error('private server details'));
  jest.mocked(changeEmail).mockRejectedValueOnce(new Error('private server details'));
  render(<ChangeEmailScreen />); fillEmail();
  fireEvent.press(screen.getByText('settingsDetails.changeEmail.sendCode'));
  await waitFor(() => expect(screen.getByText('settingsDetails.changeEmail.sendFailed')).toBeTruthy());
  fireEvent.press(screen.getByText('settingsDetails.changeEmail.submit'));
  await waitFor(() => expect(screen.getByText('settingsDetails.changeEmail.saveFailed')).toBeTruthy());
  expect(clearLocalSession).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});

test.each(['switch', 'unmount'])('email success after %s clears only the original active session without navigating', async (transition) => {
  let resolve!: () => void;
  jest.mocked(changeEmail).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const ui = render(<ChangeEmailScreen />); fillEmail();
  fireEvent.press(screen.getByText('settingsDetails.changeEmail.submit'));
  if (transition === 'switch') { mockAuth.sessionEpoch += 1; } else { ui.unmount(); }
  await act(async () => { resolve(); });
  if (transition === 'switch') expect(clearLocalSession).not.toHaveBeenCalled();
  else expect(clearLocalSession).toHaveBeenCalledWith(1, { reason: 'email-change', userInitiated: true });
  expect(mockReplace).not.toHaveBeenCalled();
});

test('email save is single flight and cannot navigate over a login during local cleanup', async () => {
  let resolve!: () => void;
  jest.mocked(clearLocalSession).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  render(<ChangeEmailScreen />); fillEmail();
  const save = screen.getByText('settingsDetails.changeEmail.submit');
  act(() => { fireEvent.press(save); fireEvent.press(save); });
  await waitFor(() => expect(clearLocalSession).toHaveBeenCalledWith(1, { reason: 'email-change', userInitiated: true }));
  expect(changeEmail).toHaveBeenCalledTimes(1);
  mockAuth.sessionEpoch = 3;
  mockAuth.user = { id: 'user-b', accountId: 'ACCOUNT-B', email: 'b@example.com' };
  await act(async () => { resolve(); });
  expect(mockReplace).not.toHaveBeenCalled();
});

test('a stale email request failure does not surface in a new session', async () => {
  let reject!: (error: Error) => void;
  jest.mocked(requestEmailChange).mockReturnValueOnce(new Promise((_done, fail) => { reject = fail; }));
  const ui = render(<ChangeEmailScreen />); fillEmail();
  fireEvent.press(screen.getByText('settingsDetails.changeEmail.sendCode'));
  mockAuth.sessionEpoch += 1;
  ui.rerender(<ChangeEmailScreen />);
  await act(async () => { reject(new Error('old account')); });
  expect(screen.queryByText('settingsDetails.changeEmail.sendFailed')).toBeNull();
  expect(screen.getByPlaceholderText('settingsDetails.changeEmail.password').props.value).toBe('');
});

test('account deletion requires account ID and explicit destructive confirmation, then runs once', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  render(<CancelAccountScreen />);
  fireEvent.press(screen.getByText('settingsDetails.cancelAccount.action'));
  expect(Alert.alert).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByPlaceholderText('settingsDetails.cancelAccount.confirmation'), 'ACCOUNT-A');
  fireEvent.press(screen.getByText('settingsDetails.cancelAccount.action'));
  expect(deleteAccount).not.toHaveBeenCalled();
  confirmDeletion(); confirmDeletion();
  await waitFor(() => expect(clearLocalSession).toHaveBeenCalledWith(1, { reason: 'account-cancel', userInitiated: true }));
  expect(deleteAccount).toHaveBeenCalledTimes(1);
  expect(deleteAccount).toHaveBeenCalledWith('user-a');
  expect(mockReplace).toHaveBeenCalledWith('/(auth)/login');
});

test('cancelling the destructive prompt never calls deletion', () => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  render(<CancelAccountScreen />);
  fireEvent.changeText(screen.getByPlaceholderText('settingsDetails.cancelAccount.confirmation'), 'ACCOUNT-A');
  fireEvent.press(screen.getByText('settingsDetails.cancelAccount.action'));
  act(() => { jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.find(button => button.style === 'cancel')?.onPress?.(); });
  expect(deleteAccount).not.toHaveBeenCalled();
});

test('a confirmation prompt from the previous account cannot delete any account', () => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  render(<CancelAccountScreen />);
  fireEvent.changeText(screen.getByPlaceholderText('settingsDetails.cancelAccount.confirmation'), 'ACCOUNT-A');
  fireEvent.press(screen.getByText('settingsDetails.cancelAccount.action'));
  mockAuth.sessionEpoch += 1;
  mockAuth.user = { id: 'user-b', accountId: 'ACCOUNT-B', email: 'b@example.com' };
  confirmDeletion();
  expect(deleteAccount).not.toHaveBeenCalled();
});

test('failed deletion preserves the session with localized feedback', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(deleteAccount).mockRejectedValueOnce(new Error('offline'));
  render(<CancelAccountScreen />);
  fireEvent.changeText(screen.getByPlaceholderText('settingsDetails.cancelAccount.confirmation'), 'ACCOUNT-A');
  fireEvent.press(screen.getByText('settingsDetails.cancelAccount.action'));
  confirmDeletion();
  await waitFor(() => expect(screen.getByText('settingsDetails.cancelAccount.failed')).toBeTruthy());
  expect(clearLocalSession).not.toHaveBeenCalled();
});

test.each(['switch', 'unmount'])('deletion success after %s clears only the original active session without navigating', async (transition) => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  let resolve!: () => void;
  jest.mocked(deleteAccount).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const ui = render(<CancelAccountScreen />);
  fireEvent.changeText(screen.getByPlaceholderText('settingsDetails.cancelAccount.confirmation'), 'ACCOUNT-A');
  fireEvent.press(screen.getByText('settingsDetails.cancelAccount.action'));
  confirmDeletion();
  if (transition === 'switch') { mockAuth.sessionEpoch += 1; } else { ui.unmount(); }
  await act(async () => { resolve(); });
  if (transition === 'switch') expect(clearLocalSession).not.toHaveBeenCalled();
  else expect(clearLocalSession).toHaveBeenCalledWith(1, { reason: 'account-cancel', userInitiated: true });
  expect(mockReplace).not.toHaveBeenCalled();
});
