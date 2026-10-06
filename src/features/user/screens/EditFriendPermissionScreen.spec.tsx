import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import EditFriendPermissionScreen from './EditFriendPermissionScreen';
import { fetchFriendSettings, setFriendPermission } from '@/services/api/friends';

const mockRouter = { back: jest.fn() };
const mockTranslate = (key: string) => key;
const mockAuth = { isAuthenticated: true, user: { id: 'owner-a' }, sessionEpoch: 1 };
let mockParams = { id: 'friend-id', name: 'Private remark' };
jest.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign((selector: (state: typeof mockAuth) => unknown) => selector(mockAuth), { getState: () => mockAuth }),
}));
jest.mock('expo-router', () => ({ router: { back: () => mockRouter.back() }, useLocalSearchParams: () => mockParams }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/theme', () => ({
  Radius: { lg: 12, xl: 18 }, Spacing: { sm: 8, md: 12, lg: 16, xl: 24 }, Typography: { body: {}, bodyRegular: {}, small: {} },
  useTheme: () => ({ colors: { background: '#fff', surface: '#fff', surfaceBorder: '#ddd', text: '#111', textSecondary: '#666', primary: '#6200ee', white: '#fff' } }),
}));
jest.mock('@/services/api/friends', () => ({ fetchFriendSettings: jest.fn(), setFriendPermission: jest.fn() }));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_error: unknown, fallback: string) => fallback }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchFriendSettings).mockReset();
  jest.mocked(setFriendPermission).mockReset().mockResolvedValue(undefined);
  Object.assign(mockAuth, { isAuthenticated: true, user: { id: 'owner-a' }, sessionEpoch: 1 });
  mockParams = { id: 'friend-id', name: 'Private remark' };
});
afterEach(() => { jest.restoreAllMocks(); });

test('a failed permission load can retry and save after recovery', async () => {
  jest.mocked(fetchFriendSettings).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ permission: 'CHAT_ONLY' } as Awaited<ReturnType<typeof fetchFriendSettings>>);
  render(<EditFriendPermissionScreen />);
  await waitFor(() => expect(screen.getByText('userProfile.editPermission.loadFailed')).toBeTruthy());
  fireEvent.press(screen.getByText('common.retry'));
  await waitFor(() => expect(screen.getByRole('radio', { selected: true })).toBeTruthy());
  fireEvent.press(screen.getByText('common.save'));
  await waitFor(() => expect(setFriendPermission).toHaveBeenCalledWith('friend-id', 'CHAT_ONLY'));
  await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
});

test('StrictMode effect replay still permits navigation after a successful save', async () => {
  jest.mocked(fetchFriendSettings).mockResolvedValue({ permission: 'FULL' } as Awaited<ReturnType<typeof fetchFriendSettings>>);
  render(<React.StrictMode><EditFriendPermissionScreen /></React.StrictMode>, { concurrentRoot: true });
  await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2));
  fireEvent.press(screen.getByText('common.save'));
  await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
});

test.each([undefined, null, {}, { permission: null }, { permission: 'UNKNOWN' }])('malformed settings %p block saving and expose a retry', async (settings) => {
  jest.mocked(fetchFriendSettings).mockResolvedValueOnce(settings as Awaited<ReturnType<typeof fetchFriendSettings>>)
    .mockResolvedValueOnce({ permission: 'FULL' } as Awaited<ReturnType<typeof fetchFriendSettings>>);
  render(<EditFriendPermissionScreen />);
  await screen.findByText('userProfile.editPermission.loadFailed');
  expect(screen.queryAllByRole('radio')).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'common.save' }).props.accessibilityState.disabled).toBe(true);
  fireEvent.press(screen.getByText('common.save'));
  expect(setFriendPermission).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('common.retry'));
  await waitFor(() => expect(screen.getByRole('radio', { selected: true })).toBeTruthy());
  fireEvent.press(screen.getByText('common.save'));
  await waitFor(() => expect(setFriendPermission).toHaveBeenCalledWith('friend-id', 'FULL'));
});

test.each(['account', 'epoch', 'route'] as const)('a slow settings response cannot populate a different %s', async (change) => {
  let resolveOld: (value: Awaited<ReturnType<typeof fetchFriendSettings>>) => void = () => {};
  let resolveNew: (value: Awaited<ReturnType<typeof fetchFriendSettings>>) => void = () => {};
  jest.mocked(fetchFriendSettings)
    .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
    .mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve; }));
  const view = render(<EditFriendPermissionScreen />);
  if (change === 'route') mockParams = { id: 'another-friend', name: 'Another' };
  else { mockAuth.sessionEpoch += 1; if (change === 'account') mockAuth.user = { id: 'owner-b' }; }
  view.rerender(<EditFriendPermissionScreen />);
  await act(async () => { resolveOld({ permission: 'CHAT_ONLY' } as Awaited<ReturnType<typeof fetchFriendSettings>>); });
  expect(screen.queryAllByRole('radio')).toHaveLength(0);
  fireEvent.press(screen.getByText('common.save'));
  expect(setFriendPermission).not.toHaveBeenCalled();
  await act(async () => { resolveNew({ permission: 'FULL' } as Awaited<ReturnType<typeof fetchFriendSettings>>); });
  fireEvent.press(screen.getByText('common.save'));
  await waitFor(() => expect(setFriendPermission).toHaveBeenCalledWith(change === 'route' ? 'another-friend' : 'friend-id', 'FULL'));
});

test.each(['resolve', 'reject'] as const)('an old save that later %ss cannot navigate, alert, or clear the new account save guard', async (outcome) => {
  let finishOld: () => void = () => {};
  let finishNew: () => void = () => {};
  jest.mocked(fetchFriendSettings).mockResolvedValue({ permission: 'FULL' } as Awaited<ReturnType<typeof fetchFriendSettings>>);
  jest.mocked(setFriendPermission)
    .mockImplementationOnce(() => new Promise((resolve, reject) => {
      finishOld = () => outcome === 'resolve' ? resolve() : reject(new Error('old failure'));
    }))
    .mockImplementationOnce(() => new Promise((resolve) => { finishNew = resolve; }));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = render(<EditFriendPermissionScreen />);
  await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2));
  fireEvent.press(screen.getByText('common.save'));
  mockAuth.user = { id: 'owner-b' }; mockAuth.sessionEpoch += 1;
  view.rerender(<EditFriendPermissionScreen />);
  await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2));
  fireEvent.press(screen.getByText('common.save'));
  await act(async () => { finishOld(); });
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
  expect(screen.getByText('common.saving')).toBeTruthy();
  await act(async () => { finishNew(); });
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

test('a rapid double press submits the permission once', async () => {
  let finish: () => void = () => {};
  jest.mocked(fetchFriendSettings).mockResolvedValue({ permission: 'CHAT_ONLY' } as Awaited<ReturnType<typeof fetchFriendSettings>>);
  jest.mocked(setFriendPermission).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<EditFriendPermissionScreen />);
  await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2));
  const save = screen.getByText('common.save');
  act(() => { fireEvent.press(save); fireEvent.press(save); });
  expect(setFriendPermission).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); });
});
