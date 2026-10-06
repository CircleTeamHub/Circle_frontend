import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import EditFriendPermissionScreen from './EditFriendPermissionScreen';
import { fetchFriendSettings, setFriendPermission } from '@/services/api/friends';

const mockRouter = { back: jest.fn() };
const mockTranslate = (key: string) => key;
jest.mock('expo-router', () => ({ router: { back: () => mockRouter.back() }, useLocalSearchParams: () => ({ id: 'friend-id' }) }));
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
beforeEach(() => { jest.clearAllMocks(); jest.mocked(setFriendPermission).mockResolvedValue(undefined); });

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
