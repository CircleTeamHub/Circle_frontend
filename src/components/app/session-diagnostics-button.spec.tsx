import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { readSessionDiagnostics } from '@/observability/session-diagnostics';
import { SessionDiagnosticsButton } from './session-diagnostics-button';

jest.mock('@/observability/session-diagnostics', () => ({ readSessionDiagnostics: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => undefined) }));
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.1', nativeBuildVersion: '100001291' }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({
  useTheme: () => ({ colors: { textSecondary: '#666' } }),
  Typography: { caption: { fontSize: 12 } }, Spacing: { md: 12 },
}));

const records = [{
  id: '12345678-1234-4234-8234-123456789abc', timestamp: 1793868600000,
  reason: 'refresh-response-invalid' as const,
  platform: 'android', appVersion: '1.0.1', buildVersion: '100001291',
  context: { status: 201, responseHasAccessToken: true, responseHasRefreshToken: false },
  requests: [],
}];

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(readSessionDiagnostics).mockResolvedValue(records);
  jest.mocked(Clipboard.setStringAsync).mockResolvedValue(true);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

test('no support control is shown without a recorded incident', async () => {
  jest.mocked(readSessionDiagnostics).mockResolvedValue([]);
  const screen = render(<SessionDiagnosticsButton />);
  await act(async () => undefined);
  expect(screen.queryByRole('button')).toBeNull();
});

test('copies retained evidence and build metadata without requiring a login', async () => {
  const screen = render(<SessionDiagnosticsButton />);
  fireEvent.press(await screen.findByRole('button', { name: 'sessionDiagnostics.copy' }));
  await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledTimes(1));
  const exported = JSON.parse(jest.mocked(Clipboard.setStringAsync).mock.calls[0][0]);
  expect(exported).toEqual({
    schemaVersion: 1, exportedAt: expect.any(String), platform: expect.any(String),
    appVersion: '1.0.1', buildVersion: '100001291', records,
  });
  expect(Alert.alert).toHaveBeenCalledWith('sessionDiagnostics.copied');
  expect(readSessionDiagnostics).toHaveBeenCalledTimes(2);
});

test('a clipboard failure is actionable and leaves the records available to retry', async () => {
  jest.mocked(Clipboard.setStringAsync).mockRejectedValueOnce(new Error('PRIVATE_CANARY'));
  const screen = render(<SessionDiagnosticsButton />);
  fireEvent.press(await screen.findByRole('button'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('sessionDiagnostics.copyFailed'));
  fireEvent.press(screen.getByRole('button'));
  await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledTimes(2));
  expect(JSON.stringify(jest.mocked(Alert.alert).mock.calls)).not.toContain('PRIVATE_CANARY');
});

test('a resolved false clipboard result reports failure instead of claiming a successful copy', async () => {
  jest.mocked(Clipboard.setStringAsync).mockResolvedValueOnce(false);
  const screen = render(<SessionDiagnosticsButton />);
  fireEvent.press(await screen.findByRole('button'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('sessionDiagnostics.copyFailed'));
  expect(Alert.alert).not.toHaveBeenCalledWith('sessionDiagnostics.copied');
});

test('disables copying until the pending clipboard write completes', async () => {
  let finish: () => void = () => undefined;
  jest.mocked(Clipboard.setStringAsync).mockReturnValueOnce(new Promise<boolean>(resolve => { finish = () => resolve(true); }));
  const screen = render(<SessionDiagnosticsButton />);
  fireEvent.press(await screen.findByRole('button'));
  await waitFor(() => expect(screen.getByRole('button').props.accessibilityState.disabled).toBe(true));
  fireEvent.press(screen.getByRole('button'));
  expect(Clipboard.setStringAsync).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(screen.getByRole('button').props.accessibilityState.disabled).toBe(false);
});
