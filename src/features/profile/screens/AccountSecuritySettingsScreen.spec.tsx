import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AccountSecuritySettingsScreen from './AccountSecuritySettingsScreen';
import { fetchSingleDeviceLoginStatus, setSingleDeviceLogin, fetchSecurityQuestions } from '@/services/api/auth';

let mockSessionEpoch = 1;
let mockSections: { rows: Row[] }[] = [];
let mockRefocus: (() => void) | null = null;
const mockPush = jest.fn();
const mockReport = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }), useFocusEffect: (callback: () => void) => { mockRefocus = callback; jest.requireActual<typeof import('react')>('react').useEffect(callback, [callback]); } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({ useTheme: () => ({ colors: {} }), Typography: { body: {} }, Spacing: { sm: 8 } }));
jest.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ logout: jest.fn(), switchAccount: jest.fn(), submitting: false }) }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: (...args: unknown[]) => mockReport(...args) }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: Object.assign((select: (state: { sessionEpoch: number }) => unknown) => select({ sessionEpoch: mockSessionEpoch }), { getState: () => ({ sessionEpoch: mockSessionEpoch }) }) }));
jest.mock('@/services/api/auth', () => ({ fetchLoginSecurityCodeStatus: jest.fn(async () => ({ enabled: false })), fetchSecurityQuestions: jest.fn(), fetchSingleDeviceLoginStatus: jest.fn(), setSingleDeviceLogin: jest.fn() }));
type Row = { id: string; valueKey?: string; disabled?: boolean; value?: boolean; onValueChange?: (value: boolean) => void; onPress?: () => void };
jest.mock('@/features/profile/components/settings-detail', () => {
  const { Pressable, Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SettingsDetailScreen: ({ sections, header }: { sections: { rows: Row[] }[]; header: React.ReactNode }) => { mockSections = sections; return <>{header}{sections.flatMap(s => s.rows.map(row => <Pressable key={row.id} testID={row.id} disabled={row.disabled} onPress={() => row.onValueChange ? row.onValueChange(!row.value) : row.onPress?.()}><Text>{String(row.value)}|{row.disabled ? 'disabled' : 'enabled'}</Text></Pressable>))}</>; } };
});
beforeEach(() => { jest.clearAllMocks(); jest.mocked(setSingleDeviceLogin).mockReset(); mockSessionEpoch = 1; jest.mocked(fetchSecurityQuestions).mockReset().mockResolvedValue([]); jest.mocked(fetchSingleDeviceLoginStatus).mockResolvedValue({ enabled: false }); jest.mocked(setSingleDeviceLogin).mockResolvedValue(undefined); });

test('failed status stays unavailable and a visible retry loads it', async () => {
  jest.mocked(fetchSingleDeviceLoginStatus).mockRejectedValueOnce(new Error('offline'));
  const ui = render(<AccountSecuritySettingsScreen />);
  await waitFor(() => expect(ui.getByText('settingsDetails.accountSecurity.singleDeviceStatusFailed')).toBeTruthy());
  expect(ui.getByTestId('single-device-login').props.accessibilityState?.disabled ?? ui.getByTestId('single-device-login').props.accessibilityState.disabled).toBe(true);
  fireEvent.press(ui.getByText('common.retry'));
  await waitFor(() => expect(ui.getByTestId('single-device-login').props.accessibilityState.disabled).toBe(false));
});

test('failed update rolls back and reports a visible error', async () => {
  jest.mocked(setSingleDeviceLogin).mockRejectedValueOnce(new Error('offline'));
  const ui = render(<AccountSecuritySettingsScreen />);
  await waitFor(() => expect(ui.getByTestId('single-device-login').props.accessibilityState.disabled).toBeFalsy());
  fireEvent.press(ui.getByTestId('single-device-login'));
  await waitFor(() => expect(ui.getByText('settingsDetails.accountSecurity.singleDeviceUpdateFailed')).toBeTruthy());
  expect(ui.getByTestId('single-device-login').findByType(Text).props.children).toEqual(['false', '|', 'enabled']);
});

test('stale update does not show an error or rollback the next session', async () => {
  let reject!: (error: Error) => void;
  jest.mocked(setSingleDeviceLogin).mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
  const ui = render(<AccountSecuritySettingsScreen />);
  await waitFor(() => expect(ui.getByTestId('single-device-login').props.accessibilityState.disabled).toBeFalsy());
  fireEvent.press(ui.getByTestId('single-device-login'));
  mockSessionEpoch += 1;
  ui.rerender(<AccountSecuritySettingsScreen />);
  await act(async () => { reject(new Error('old request')); });
  expect(ui.queryByText('settingsDetails.accountSecurity.singleDeviceUpdateFailed')).toBeNull();
  expect(mockReport).not.toHaveBeenCalled();
});

test('an old status response cannot replace the next account status', async () => {
  let resolve!: (status: { enabled: boolean }) => void;
  jest.mocked(fetchSingleDeviceLoginStatus).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const ui = render(<AccountSecuritySettingsScreen />);
  mockSessionEpoch += 1;
  ui.rerender(<AccountSecuritySettingsScreen />);
  await waitFor(() => expect(ui.getByTestId('single-device-login').props.accessibilityState.disabled).toBe(false));
  await act(async () => { resolve({ enabled: true }); });
  expect(ui.getByTestId('single-device-login').findByType(Text).props.children).toEqual(['false', '|', 'enabled']);
});

test('an update failure after leaving the screen is ignored', async () => {
  let reject!: (error: Error) => void;
  jest.mocked(setSingleDeviceLogin).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
  const ui = render(<AccountSecuritySettingsScreen />);
  await waitFor(() => expect(ui.getByTestId('single-device-login').props.accessibilityState.disabled).toBe(false));
  fireEvent.press(ui.getByTestId('single-device-login'));
  ui.unmount();
  await act(async () => { reject(new Error('old request')); });
  expect(mockReport).not.toHaveBeenCalled();
});

test('cancel account opens the dedicated screen', async () => {
  const ui = render(<AccountSecuritySettingsScreen />);
  fireEvent.press(ui.getByTestId('cancel-account'));
  expect(mockPush).toHaveBeenCalledWith('/(tabs)/profile/cancel-account');
  await act(async () => {});
});




const securityQuestionsRow = () =>
  mockSections.flatMap((section) => section.rows).find((row) => row.id === 'security-questions');

test('an older status response arriving last does not overwrite the newer one', async () => {
  const pending: ((keys: string[]) => void)[] = [];
  jest.mocked(fetchSecurityQuestions).mockImplementation(
    () => new Promise((resolve) => pending.push(resolve as (keys: string[]) => void)) as never,
  );
  render(<AccountSecuritySettingsScreen />);
  await waitFor(() => expect(pending).toHaveLength(1));

  // 从密保设置页返回：再次聚焦，第二个请求发出，而第一个还没回来。
  act(() => mockRefocus!());
  expect(pending).toHaveLength(2);

  await act(async () => pending[1](['birthCity', 'firstPetName']));
  await act(async () => pending[0]([]));

  expect(securityQuestionsRow()?.valueKey).toBe(
    'settingsDetails.accountSecurity.securityQuestionsSet',
  );
});

test('a failed refresh hides the last known status instead of showing it as current', async () => {
  jest
    .mocked(fetchSecurityQuestions)
    .mockResolvedValueOnce(['birthCity', 'firstPetName'])
    .mockRejectedValueOnce(new Error('offline'));
  render(<AccountSecuritySettingsScreen />);
  await waitFor(() =>
    expect(securityQuestionsRow()?.valueKey).toBe(
      'settingsDetails.accountSecurity.securityQuestionsSet',
    ),
  );

  await act(async () => mockRefocus!());

  expect(securityQuestionsRow()?.valueKey).toBeUndefined();
});
