import React from 'react';
import { Alert, Linking, Platform } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import NotificationSettingsScreen from './NotificationSettingsScreen';
import { useAppSettingsStore, appSettingsDefaults } from '../store/use-app-settings-store';
import { useNotificationFeedbackStore } from '@/features/notifications/store/use-notification-feedback-store';
import { fetchGroupOfflinePushEnabled, updateGroupOfflinePushEnabled } from '@/services/api/notifications';

const mockT = (key: string) => key;
const mockEpoch = { sessionEpoch: 1 };
jest.mock('@/storage', () => ({ mmkvJsonStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: Object.assign((s: (x: typeof mockEpoch) => unknown) => s(mockEpoch), { getState: () => mockEpoch }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('@/i18n', () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock('@/theme', () => ({ useTheme: () => ({ colors: { primary: '#00f', error: '#f00' } }) }));
jest.mock('@/features/discover/hooks/use-circle-notification-tiers', () => ({ useCircleNotificationTiers: () => ({ globalEnabled: true, soundValue: true, offlineValue: true }) }));
jest.mock('@/services/api/notifications', () => ({ fetchGroupOfflinePushEnabled: jest.fn(), updateGroupOfflinePushEnabled: jest.fn() }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/features/profile/components/settings-detail', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return { SettingsDetailScreen: ({ sections, header }: { sections: { rows: { id: string; value?: boolean; valueText?: string; disabled?: boolean; onPress?: () => void; onValueChange?: (v: boolean) => void }[] }[]; header?: React.ReactNode }) => <View>{header}{sections.flatMap(s => s.rows).map(row => <Pressable key={row.id} testID={row.id} disabled={row.disabled} onPress={() => row.onPress ? row.onPress() : row.onValueChange?.(!row.value)}><Text>{String(row.value ?? row.valueText ?? '')}</Text></Pressable>)}</View> };
});
jest.mock('@/components/ui/option-picker-sheet', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return { OptionPickerSheet: ({ visible, options, onSelect, onClose }: { visible: boolean; options: { value: string; label: string }[]; onSelect: (v: string) => void; onClose: () => void }) => visible ? options.map(o => <Pressable key={o.value} onPress={() => { onSelect(o.value); onClose(); }}><Text>{o.label}</Text></Pressable>) : null };
});

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  mockEpoch.sessionEpoch++;
  useAppSettingsStore.setState({ settings: { ...appSettingsDefaults } });
  useNotificationFeedbackStore.setState({ messageRingtone: 'default', circleRingtone: 'default' });
  jest.mocked(fetchGroupOfflinePushEnabled).mockResolvedValue(true);
});

test('web system notification entry explains browser permissions without calling native settings', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  render(<NotificationSettingsScreen />);
  fireEvent.press(screen.getByTestId('system-notifications'));
  expect(open).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith('settingsDetails.permissions.title', 'settingsDetails.permissions.browserSettingsHint');
  await act(async () => {});
});

test('group offline changes reach the server and failed saves roll back', async () => {
  jest.mocked(updateGroupOfflinePushEnabled).mockRejectedValueOnce(new Error('offline'));
  render(<NotificationSettingsScreen />);
  await waitFor(() => expect(screen.getByTestId('group-offline')).not.toBeDisabled());
  expect(screen.getByTestId('group-offline')).toHaveTextContent('true');
  await act(async () => fireEvent.press(screen.getByTestId('group-offline')));
  expect(updateGroupOfflinePushEnabled).toHaveBeenCalledWith(false);
  expect(screen.getByTestId('group-offline')).toHaveTextContent('true');
  expect(screen.getByText('settingsDetails.notifications.syncFailed')).toBeTruthy();
});

test('turning off group global push also disables server-side offline delivery', async () => {
  jest.mocked(updateGroupOfflinePushEnabled).mockResolvedValue(false);
  render(<NotificationSettingsScreen />);
  await waitFor(() => expect(screen.getByTestId('group-global')).not.toBeDisabled());
  await act(async () => fireEvent.press(screen.getByTestId('group-global')));
  expect(updateGroupOfflinePushEnabled).toHaveBeenCalledWith(false);
  expect(screen.getByTestId('group-online')).toBeDisabled();
});

test('a failed save still rolls back the account preference after leaving the screen', async () => {
  let rejectSave!: (reason: Error) => void;
  jest.mocked(updateGroupOfflinePushEnabled).mockReturnValueOnce(new Promise((_, reject) => { rejectSave = reject; }));
  const view = render(<NotificationSettingsScreen />);
  await waitFor(() => expect(screen.getByTestId('group-global')).not.toBeDisabled());
  fireEvent.press(screen.getByTestId('group-global'));
  expect(useAppSettingsStore.getState().settings.groupGlobalPush).toBe(false);
  view.unmount();
  await act(async () => rejectSave(new Error('offline')));
  expect(useAppSettingsStore.getState().settings.groupGlobalPush).toBe(true);
});

test('an older failed screen save cannot roll back a newer confirmed choice', async () => {
  let rejectSave!: (reason: Error) => void;
  jest.mocked(updateGroupOfflinePushEnabled).mockReturnValueOnce(new Promise((_, reject) => { rejectSave = reject; })).mockResolvedValueOnce(false);
  const first = render(<NotificationSettingsScreen />);
  await waitFor(() => expect(screen.getByTestId('group-offline')).not.toBeDisabled());
  fireEvent.press(screen.getByTestId('group-offline'));
  first.unmount();
  render(<NotificationSettingsScreen />);
  await waitFor(() => expect(screen.getByTestId('group-offline')).toHaveTextContent('true'));
  await act(async () => fireEvent.press(screen.getByTestId('group-offline')));
  await act(async () => rejectSave(new Error('offline')));
  expect(useAppSettingsStore.getState().settings.groupOfflinePush).toBe(false);
});

test('an old account save failure never rolls back the current account', async () => {
  let rejectSave!: (reason: Error) => void;
  jest.mocked(updateGroupOfflinePushEnabled).mockReturnValueOnce(new Promise((_, reject) => { rejectSave = reject; }));
  const view = render(<NotificationSettingsScreen />);
  await waitFor(() => expect(screen.getByTestId('group-global')).not.toBeDisabled());
  fireEvent.press(screen.getByTestId('group-global'));
  view.unmount();
  mockEpoch.sessionEpoch++;
  await act(async () => rejectSave(new Error('offline')));
  expect(useAppSettingsStore.getState().settings.groupGlobalPush).toBe(false);
});

test('a confirmed save reconciles an old GET returned after reopening the screen', async () => {
  let finishSave!: (value: boolean) => void;
  jest.mocked(updateGroupOfflinePushEnabled).mockReturnValueOnce(new Promise(resolve => { finishSave = resolve; }));
  const first = render(<NotificationSettingsScreen />);
  await waitFor(() => expect(screen.getByTestId('group-offline')).not.toBeDisabled());
  fireEvent.press(screen.getByTestId('group-offline'));
  first.unmount();
  render(<NotificationSettingsScreen />);
  await waitFor(() => expect(screen.getByTestId('group-offline')).toHaveTextContent('true'));
  await act(async () => finishSave(false));
  expect(useAppSettingsStore.getState().settings.groupOfflinePush).toBe(false);
});

test('a GET started before save confirmation cannot overwrite the confirmed preference', async () => {
  let finishSave!: (value: boolean) => void;
  let finishLoad!: (value: boolean) => void;
  jest.mocked(updateGroupOfflinePushEnabled).mockReturnValueOnce(new Promise(resolve => { finishSave = resolve; }));
  const first = render(<NotificationSettingsScreen />);
  await waitFor(() => expect(screen.getByTestId('group-offline')).not.toBeDisabled());
  fireEvent.press(screen.getByTestId('group-offline'));
  first.unmount();
  jest.mocked(fetchGroupOfflinePushEnabled).mockReturnValueOnce(new Promise(resolve => { finishLoad = resolve; }));
  render(<NotificationSettingsScreen />);
  await act(async () => finishSave(false));
  await act(async () => finishLoad(true));
  expect(useAppSettingsStore.getState().settings.groupOfflinePush).toBe(false);
  expect(screen.getByTestId('group-offline')).not.toBeDisabled();
});

test('a failed initial group preference load exposes retry and keeps remote controls disabled', async () => {
  jest.mocked(fetchGroupOfflinePushEnabled).mockRejectedValueOnce(new Error('offline'));
  render(<NotificationSettingsScreen />);
  await waitFor(() => expect(screen.getByText('common.retry')).toBeTruthy());
  expect(screen.getByTestId('group-global')).toBeDisabled();
  fireEvent.press(screen.getByText('common.retry'));
  await waitFor(() => expect(screen.getByTestId('group-global')).not.toBeDisabled());
});

test('both ringtone rows open working selectors and persist their choices separately', async () => {
  render(<NotificationSettingsScreen />);
  fireEvent.press(screen.getByTestId('message-ringtone'));
  fireEvent.press(screen.getByText('settingsDetails.notifications.ringtones.soft'));
  expect(useNotificationFeedbackStore.getState().messageRingtone).toBe('soft');
  fireEvent.press(screen.getByTestId('circle-ringtone'));
  fireEvent.press(screen.getByText('settingsDetails.notifications.ringtones.bell'));
  expect(useNotificationFeedbackStore.getState().circleRingtone).toBe('bell');
  await act(async () => {});
});

// 半窗是这台设备上的偏好:默认开,关掉后点横幅直接进完整聊天。
test('the half-screen chat switch defaults to on and saves the choice', async () => {
  render(<NotificationSettingsScreen />);
  await waitFor(() => expect(screen.getByTestId('group-offline')).not.toBeDisabled());
  expect(screen.getByTestId('quick-chat-sheet')).toHaveTextContent('true');
  await act(async () => fireEvent.press(screen.getByTestId('quick-chat-sheet')));
  expect(useAppSettingsStore.getState().settings.quickChatSheet).toBe(false);
  expect(updateGroupOfflinePushEnabled).not.toHaveBeenCalled();
});

test.each(['zh', 'en', 'ja', 'ko', 'es'])('the half-screen chat switch is translated for %s', (locale) => {
  const { notifications } = jest.requireActual(`@/i18n/locales/${locale}.json`).settingsDetails;
  expect(notifications.quickChatSheet).toBeTruthy();
  expect(notifications.quickChatSheetHint).toBeTruthy();
});

