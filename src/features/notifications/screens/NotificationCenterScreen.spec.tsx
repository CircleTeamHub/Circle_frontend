import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import NotificationCenterScreen from './NotificationCenterScreen';
import { fetchNotificationsPage } from '@/services/api/notifications';

const mockTranslate = (key: string) => key;
const mockSegments = ['(tabs)', 'messages'];
const mockAppendPage = jest.fn();
const mockState = { interactive: [], signupPosts: [], setInteractiveForDomain: jest.fn(), appendInteractivePage: mockAppendPage, setSignupPosts: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }), useSegments: () => mockSegments, useLocalSearchParams: () => ({ domain: 'moments' }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock('react-native', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  const actual = jest.requireActual<typeof import('react-native')>('react-native');
  return new Proxy(actual, { get(target, property, receiver) {
    if (property !== 'FlatList') return Reflect.get(target, property, receiver);
    return ({ onEndReached, onRefresh, ListFooterComponent }: { onEndReached: () => void; onRefresh: () => void; ListFooterComponent: React.ReactNode }) =>
      ReactModule.createElement(actual.View, null,
        ReactModule.createElement(actual.Pressable, { testID: 'list-end', onPress: onEndReached }),
        ReactModule.createElement(actual.Pressable, { testID: 'list-refresh', onPress: onRefresh }),
        ListFooterComponent);
  } });
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/theme', () => ({
  Spacing: { sm: 8, md: 12, lg: 16, xl: 24 },
  useTheme: () => ({ colors: { background: '#fff', surface: '#fff', text: '#111', textSecondary: '#666', primary: '#6200ee' } }),
}));
jest.mock('@/components/ui/divider', () => ({ Divider: () => null }));
jest.mock('@/features/notifications/components/NotificationTabBar', () => ({ NotificationTabBar: () => null }));
jest.mock('@/features/notifications/components/ReadFilterBar', () => ({ ReadFilterBar: () => null }));
jest.mock('@/features/notifications/components/NotificationRow', () => ({ NotificationRow: () => null }));
jest.mock('@/features/notifications/components/NotificationEmptyState', () => ({ NotificationEmptyState: () => null }));
jest.mock('@/services/api/notifications', () => ({ fetchNotificationsPage: jest.fn(), markAllNotificationsRead: jest.fn(), markNotificationRead: jest.fn() }));
jest.mock('@/services/api/plaza', () => ({ fetchAllMyCirclePosts: jest.fn(), markMyPostSignupsRead: jest.fn() }));
jest.mock('@/stores/tabBadgeStore', () => ({ useTabBadgeStore: { getState: () => ({}) } }));
jest.mock('@/features/notifications/store/use-notification-center-store', () => ({
  useNotificationCenterStore: Object.assign((selector: (state: typeof mockState) => unknown) => selector(mockState), { getState: () => mockState }),
}));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
beforeEach(() => { jest.clearAllMocks(); jest.mocked(fetchNotificationsPage).mockReset(); });

test('a failed cursor page stops automatic requests until an explicit retry', async () => {
  jest.mocked(fetchNotificationsPage).mockResolvedValueOnce({ items: [], nextCursor: 'cursor-1' }).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [], nextCursor: null });
  render(<NotificationCenterScreen />);
  await waitFor(() => expect(fetchNotificationsPage).toHaveBeenCalledTimes(1));
  await act(async () => { await Promise.resolve(); });
  fireEvent.press(screen.getByTestId('list-end'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'common.retry' })).toBeTruthy());
  fireEvent.press(screen.getByTestId('list-end'));
  fireEvent.press(screen.getByTestId('list-end'));
  expect(fetchNotificationsPage).toHaveBeenCalledTimes(2);
  fireEvent.press(screen.getByRole('button', { name: 'common.retry' }));
  await waitFor(() => expect(fetchNotificationsPage).toHaveBeenCalledTimes(3));
  expect(fetchNotificationsPage).toHaveBeenLastCalledWith('cursor-1', 'moments');
  await waitFor(() => expect(mockAppendPage).toHaveBeenCalledTimes(1));
});

test('refresh invalidates an older pending page instead of appending it to fresh data', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof fetchNotificationsPage>>) => void;
  jest.mocked(fetchNotificationsPage).mockResolvedValueOnce({ items: [], nextCursor: 'old' })
    .mockImplementationOnce(() => new Promise((done) => { resolve = done; }))
    .mockResolvedValueOnce({ items: [], nextCursor: 'fresh' });
  render(<NotificationCenterScreen />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.press(screen.getByTestId('list-end'));
  await waitFor(() => expect(fetchNotificationsPage).toHaveBeenCalledTimes(2));
  fireEvent.press(screen.getByTestId('list-refresh'));
  await waitFor(() => expect(fetchNotificationsPage).toHaveBeenCalledTimes(3));
  await act(async () => { resolve({ items: [], nextCursor: null }); });
  expect(mockAppendPage).not.toHaveBeenCalled();
});
