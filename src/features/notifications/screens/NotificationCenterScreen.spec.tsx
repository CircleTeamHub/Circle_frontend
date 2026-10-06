import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ActivityIndicator } from 'react-native';
import NotificationCenterScreen from './NotificationCenterScreen';
import { fetchNotificationsPage, markAllNotificationsRead } from '@/services/api/notifications';
import { fetchAllMyCirclePosts, markMyPostSignupsRead } from '@/services/api/plaza';
import { useNotificationCenterStore } from '@/features/notifications/store/use-notification-center-store';
import { useAuthStore, type AuthUser } from '@/stores/authStore';
import { reportHandledFailure } from '@/observability/report-failure';
import type { MyCirclePost, NotificationItem } from '@/types';

const mockTranslate = (key: string) => key;
const mockSegments = ['(tabs)', 'messages'];
let mockDomain = 'moments';
const originalAppendPage = useNotificationCenterStore.getState().appendInteractivePage;
const mockAppendPage = jest.fn(originalAppendPage);
const mockBadges = {
  discoverUnread: 0, momentsUnread: 0, circleUnread: 0, signupUnread: 0,
  setDiscoverUnread: jest.fn((count) => { mockBadges.discoverUnread = count; }),
  setMomentsUnread: jest.fn((count) => { mockBadges.momentsUnread = count; }),
  setCircleUnread: jest.fn((count) => { mockBadges.circleUnread = count; }),
  setSignupUnread: jest.fn((count) => { mockBadges.signupUnread = count; }),
};
jest.mock('@/stores/authStore', () => {
  const { create } = jest.requireActual('zustand');
  return { useAuthStore: create(() => ({ user: { id: 'account-a' }, isAuthenticated: true, sessionEpoch: 1 })) };
});
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }), useSegments: () => mockSegments, useLocalSearchParams: () => ({ domain: mockDomain }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock('react-native', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  const actual = jest.requireActual<typeof import('react-native')>('react-native');
  return new Proxy(actual, { get(target, property, receiver) {
    if (property !== 'FlatList') return Reflect.get(target, property, receiver);
    return ({ onEndReached, onRefresh, ListFooterComponent, data, renderItem }: { onEndReached: () => void; onRefresh: () => void; ListFooterComponent: React.ReactNode; data: { view: { id: string } }[]; renderItem: (args: { item: { view: { id: string } } }) => React.ReactNode }) =>
      ReactModule.createElement(actual.View, null,
        ReactModule.createElement(actual.Pressable, { testID: 'list-end', onPress: onEndReached }),
        ReactModule.createElement(actual.Pressable, { testID: 'list-refresh', onPress: onRefresh }),
        ...data.map((item) => ReactModule.createElement(ReactModule.Fragment, { key: item.view.id }, renderItem({ item }))),
        ListFooterComponent);
  } });
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/theme', () => ({
  Spacing: { sm: 8, md: 12, lg: 16, xl: 24 },
  useTheme: () => ({ colors: { background: '#fff', surface: '#fff', text: '#111', textSecondary: '#666', primary: '#6200ee' } }),
}));
jest.mock('@/components/ui/divider', () => ({ Divider: () => null }));
jest.mock('@/features/notifications/components/NotificationTabBar', () => ({ NotificationTabBar: ({ onSelect }: { onSelect: (tab: string) => void }) => {
  const { Pressable, View } = jest.requireActual('react-native');
  return <View>
    <Pressable testID="signup-tab" onPress={() => onSelect('signups')} />
    <Pressable testID="notifications-tab" onPress={() => onSelect('notifications')} />
  </View>;
} }));
jest.mock('@/features/notifications/components/ReadFilterBar', () => ({ ReadFilterBar: ({ onMarkAll }: { onMarkAll: () => void }) => {
  const { Pressable } = jest.requireActual('react-native');
  return <Pressable testID="mark-all" onPress={onMarkAll} />;
} }));
jest.mock('@/features/notifications/components/NotificationRow', () => ({ NotificationRow: ({ data }: { data: { id: string } }) => {
  const { Text } = jest.requireActual('react-native');
  return <Text>{data.id}</Text>;
} }));
jest.mock('@/features/notifications/components/NotificationEmptyState', () => ({ NotificationEmptyState: () => null }));
jest.mock('@/services/api/notifications', () => ({ fetchNotificationsPage: jest.fn(), markAllNotificationsRead: jest.fn(), markNotificationRead: jest.fn() }));
jest.mock('@/services/api/plaza', () => ({ fetchAllMyCirclePosts: jest.fn(), markMyPostSignupsRead: jest.fn() }));
jest.mock('@/stores/tabBadgeStore', () => ({ useTabBadgeStore: { getState: () => mockBadges } }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchNotificationsPage).mockReset();
  jest.mocked(fetchAllMyCirclePosts).mockReset().mockResolvedValue([]);
  jest.mocked(markAllNotificationsRead).mockReset();
  jest.mocked(markMyPostSignupsRead).mockReset();
  mockDomain = 'moments';
  useAuthStore.setState({ user: { id: 'account-a' } as AuthUser, isAuthenticated: true, sessionEpoch: 1 });
  useNotificationCenterStore.getState().reset();
  useNotificationCenterStore.setState({ appendInteractivePage: mockAppendPage });
  Object.assign(mockBadges, { discoverUnread: 0, momentsUnread: 0, circleUnread: 0, signupUnread: 0 });
});

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

test('a failed notification page shows its retry only on the notifications tab', async () => {
  mockDomain = 'circle';
  jest.mocked(fetchNotificationsPage)
    .mockResolvedValueOnce({ items: [], nextCursor: 'cursor-1' })
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ items: [], nextCursor: null });
  render(<NotificationCenterScreen />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.press(screen.getByTestId('list-end'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'common.retry' })).toBeTruthy());
  fireEvent.press(screen.getByTestId('signup-tab'));
  expect(screen.queryByRole('button', { name: 'common.retry' })).toBeNull();
  expect(screen.UNSAFE_queryByType(ActivityIndicator)).toBeNull();
  fireEvent.press(screen.getByTestId('list-end'));
  expect(fetchNotificationsPage).toHaveBeenCalledTimes(2);
  fireEvent.press(screen.getByTestId('notifications-tab'));
  fireEvent.press(screen.getByRole('button', { name: 'common.retry' }));
  await waitFor(() => expect(fetchNotificationsPage).toHaveBeenCalledTimes(3));
  expect(fetchNotificationsPage).toHaveBeenLastCalledWith('cursor-1', 'circle');
});

test.each(['success', 'failure'] as const)('a pending notification page and its late %s do not put pagination controls in signup', async (outcome) => {
  mockDomain = 'circle';
  const page = deferred<Awaited<ReturnType<typeof fetchNotificationsPage>>>();
  jest.mocked(fetchNotificationsPage)
    .mockResolvedValueOnce({ items: [], nextCursor: 'cursor-1' })
    .mockReturnValueOnce(page.promise);
  render(<NotificationCenterScreen />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.press(screen.getByTestId('list-end'));
  expect(screen.UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  fireEvent.press(screen.getByTestId('signup-tab'));
  expect(screen.UNSAFE_queryByType(ActivityIndicator)).toBeNull();
  expect(screen.queryByRole('button', { name: 'common.retry' })).toBeNull();
  await act(async () => {
    if (outcome === 'success') page.resolve({ items: [notification('background-page', 'CIRCLE_POST_PUBLISHED')], nextCursor: null });
    else page.reject(new Error('offline'));
  });
  expect(screen.UNSAFE_queryByType(ActivityIndicator)).toBeNull();
  expect(screen.queryByRole('button', { name: 'common.retry' })).toBeNull();
  expect(screen.queryByText('background-page')).toBeNull();
  fireEvent.press(screen.getByTestId('list-end'));
  expect(fetchNotificationsPage).toHaveBeenCalledTimes(2);
  fireEvent.press(screen.getByTestId('notifications-tab'));
  expect(screen.UNSAFE_queryByType(ActivityIndicator)).toBeNull();
  if (outcome === 'success') expect(screen.getByText('background-page')).toBeTruthy();
  else expect(screen.getByRole('button', { name: 'common.retry' })).toBeTruthy();
});

test('an old notification page finally cannot clear a new page spinner after signup refresh', async () => {
  mockDomain = 'circle';
  const old = deferred<Awaited<ReturnType<typeof fetchNotificationsPage>>>();
  const current = deferred<Awaited<ReturnType<typeof fetchNotificationsPage>>>();
  jest.mocked(fetchNotificationsPage)
    .mockResolvedValueOnce({ items: [], nextCursor: 'old-cursor' })
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce({ items: [], nextCursor: 'fresh-cursor' })
    .mockReturnValueOnce(current.promise);
  render(<NotificationCenterScreen />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.press(screen.getByTestId('list-end'));
  fireEvent.press(screen.getByTestId('signup-tab'));
  fireEvent.press(screen.getByTestId('list-refresh'));
  await act(async () => { await Promise.resolve(); });
  fireEvent.press(screen.getByTestId('notifications-tab'));
  fireEvent.press(screen.getByTestId('list-end'));
  expect(fetchNotificationsPage).toHaveBeenLastCalledWith('fresh-cursor', 'circle');
  expect(screen.UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  await act(async () => { old.resolve({ items: [notification('stale-page', 'CIRCLE_POST_PUBLISHED')], nextCursor: null }); });
  expect(screen.UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  expect(mockAppendPage).not.toHaveBeenCalled();
  await act(async () => { current.resolve({ items: [notification('current-page', 'CIRCLE_POST_PUBLISHED')], nextCursor: null }); });
  expect(screen.UNSAFE_queryByType(ActivityIndicator)).toBeNull();
  expect(screen.getByText('current-page')).toBeTruthy();
  expect(screen.queryByText('stale-page')).toBeNull();
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


test('failed refresh keeps the cached cursor usable for the next page', async () => {
  jest.mocked(fetchNotificationsPage).mockResolvedValueOnce({ items: [], nextCursor: 'cached-cursor' })
    .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [], nextCursor: null });
  render(<NotificationCenterScreen />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.press(screen.getByTestId('list-refresh'));
  await waitFor(() => expect(fetchNotificationsPage).toHaveBeenCalledTimes(2));
  await act(async () => { await Promise.resolve(); });
  fireEvent.press(screen.getByTestId('list-end'));
  await waitFor(() => expect(fetchNotificationsPage).toHaveBeenCalledTimes(3));
  expect(fetchNotificationsPage).toHaveBeenLastCalledWith('cached-cursor', 'moments');
});

function notification(id: string, type: NotificationItem['type'] = 'TRACE_LIKE'): NotificationItem {
  return { id, type, content: id, read: false, createdAt: '2026-10-06T10:00:00Z', fromUser: null, fromTrace: null, fromReply: null, fromCircle: null, fromCirclePost: null, fromInvitation: null };
}

function post(id: string): MyCirclePost {
  return { id, circleId: 'circle', excerpt: id, firstImage: null, signupCount: 2, unreadSignupCount: 2, status: 'ACTIVE', createdAt: '2026-10-06T10:00:00Z', expiresAt: '2026-10-07T10:00:00Z' };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function switchAccount(owner = 'account-b') {
  useNotificationCenterStore.getState().reset();
  useAuthStore.setState({ user: { id: owner } as AuthUser, sessionEpoch: 2 });
}

test.each(['success', 'failure'])('account change starts a fresh load and ignores old account initial %s', async (outcome) => {
  const old = deferred<Awaited<ReturnType<typeof fetchNotificationsPage>>>();
  jest.mocked(fetchNotificationsPage).mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce({ items: [notification('b-notification')], nextCursor: 'b-cursor' });
  render(<NotificationCenterScreen />);
  await act(async () => { switchAccount(); });
  await waitFor(() => expect(screen.getByText('b-notification')).toBeTruthy());
  await act(async () => {
    if (outcome === 'success') old.resolve({ items: [notification('a-private')], nextCursor: 'a-cursor' });
    else old.reject(new Error('old account offline'));
  });
  expect(fetchNotificationsPage).toHaveBeenCalledTimes(2);
  expect(useNotificationCenterStore.getState().interactive.map((item) => item.id)).toEqual(['b-notification']);
  expect(screen.queryByText('a-private')).toBeNull();
  expect(reportHandledFailure).not.toHaveBeenCalled();
});

test.each(['success', 'failure'])('a new session of the same account ignores the old page %s', async (outcome) => {
  const old = deferred<Awaited<ReturnType<typeof fetchNotificationsPage>>>();
  jest.mocked(fetchNotificationsPage).mockResolvedValueOnce({ items: [], nextCursor: 'a-cursor' })
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce({ items: [notification('new-session')], nextCursor: 'new-cursor' })
    .mockResolvedValueOnce({ items: [notification('new-page')], nextCursor: null });
  render(<NotificationCenterScreen />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.press(screen.getByTestId('list-end'));
  await waitFor(() => expect(fetchNotificationsPage).toHaveBeenCalledTimes(2));
  await act(async () => { switchAccount('account-a'); });
  await waitFor(() => expect(screen.getByText('new-session')).toBeTruthy());
  await act(async () => {
    if (outcome === 'success') old.resolve({ items: [notification('old-page')], nextCursor: null });
    else old.reject(new Error('old session offline'));
  });
  expect(mockAppendPage).not.toHaveBeenCalled();
  expect(reportHandledFailure).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('list-end'));
  await waitFor(() => expect(fetchNotificationsPage).toHaveBeenCalledTimes(4));
  expect(fetchNotificationsPage).toHaveBeenLastCalledWith('new-cursor', 'moments');
  await waitFor(() => expect(screen.getByText('new-page')).toBeTruthy());
});

test('cleared account caches stay empty when the new account refresh fails', async () => {
  jest.mocked(fetchNotificationsPage).mockResolvedValueOnce({ items: [notification('a-private')], nextCursor: 'a-cursor' })
    .mockRejectedValueOnce(new Error('new account offline'));
  render(<NotificationCenterScreen />);
  await waitFor(() => expect(screen.getByText('a-private')).toBeTruthy());
  act(() => { useNotificationCenterStore.getState().setSignupPosts([post('a-private-post')]); });
  await act(async () => { switchAccount(); });
  await waitFor(() => expect(fetchNotificationsPage).toHaveBeenCalledTimes(2));
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByText('a-private')).toBeNull();
  expect(useNotificationCenterStore.getState().interactive).toEqual([]);
  expect(useNotificationCenterStore.getState().signupPosts).toEqual([]);
  fireEvent.press(screen.getByTestId('list-end'));
  expect(fetchNotificationsPage).toHaveBeenCalledTimes(2);
});

test('old mark-all rejection cannot restore notifications or badges into a new account', async () => {
  const old = deferred<Awaited<ReturnType<typeof markAllNotificationsRead>>>();
  jest.mocked(markAllNotificationsRead).mockReturnValueOnce(old.promise);
  jest.mocked(fetchNotificationsPage).mockResolvedValueOnce({ items: [notification('a-private')], nextCursor: null })
    .mockResolvedValueOnce({ items: [notification('b-notification')], nextCursor: null });
  render(<NotificationCenterScreen />);
  await waitFor(() => expect(screen.getByText('a-private')).toBeTruthy());
  Object.assign(mockBadges, { discoverUnread: 2, momentsUnread: 2 });
  fireEvent.press(screen.getByTestId('mark-all'));
  await waitFor(() => expect(markAllNotificationsRead).toHaveBeenCalledTimes(1));
  await act(async () => { switchAccount(); });
  await waitFor(() => expect(screen.getByText('b-notification')).toBeTruthy());
  Object.assign(mockBadges, { discoverUnread: 7, momentsUnread: 7 });
  await act(async () => { old.reject(new Error('old mark-all failed')); });
  expect(useNotificationCenterStore.getState().interactive.map((item) => item.id)).toEqual(['b-notification']);
  expect(mockBadges.discoverUnread).toBe(7);
  expect(mockBadges.momentsUnread).toBe(7);
  expect(reportHandledFailure).not.toHaveBeenCalled();
  expect(fetchNotificationsPage).toHaveBeenCalledTimes(2);
});

test('old signup mark-all rejection cannot restore posts or badges into a new account', async () => {
  mockDomain = 'circle';
  const old = deferred<Awaited<ReturnType<typeof markMyPostSignupsRead>>>();
  jest.mocked(markMyPostSignupsRead).mockReturnValueOnce(old.promise);
  jest.mocked(fetchNotificationsPage).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(fetchAllMyCirclePosts).mockResolvedValueOnce([post('a-private-post')])
    .mockResolvedValueOnce([post('b-post')]);
  render(<NotificationCenterScreen />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.press(screen.getByTestId('signup-tab'));
  await waitFor(() => expect(screen.getByText('a-private-post')).toBeTruthy());
  mockBadges.signupUnread = 2;
  fireEvent.press(screen.getByTestId('mark-all'));
  await waitFor(() => expect(markMyPostSignupsRead).toHaveBeenCalledWith('a-private-post'));
  await act(async () => { switchAccount(); });
  await waitFor(() => expect(screen.getByText('b-post')).toBeTruthy());
  mockBadges.signupUnread = 9;
  await act(async () => { old.reject(new Error('old signup mark-all failed')); });
  expect(useNotificationCenterStore.getState().signupPosts.map((item) => item.id)).toEqual(['b-post']);
  expect(mockBadges.signupUnread).toBe(9);
  expect(reportHandledFailure).not.toHaveBeenCalled();
  expect(fetchAllMyCirclePosts).toHaveBeenCalledTimes(2);
});

test('unmounted mark-all rejection neither rolls back nor reports', async () => {
  const old = deferred<Awaited<ReturnType<typeof markAllNotificationsRead>>>();
  jest.mocked(markAllNotificationsRead).mockReturnValueOnce(old.promise);
  jest.mocked(fetchNotificationsPage).mockResolvedValueOnce({ items: [notification('a-notification')], nextCursor: null });
  const view = render(<NotificationCenterScreen />);
  await waitFor(() => expect(screen.getByText('a-notification')).toBeTruthy());
  fireEvent.press(screen.getByTestId('mark-all'));
  view.unmount();
  await act(async () => { old.reject(new Error('late failure')); });
  expect(useNotificationCenterStore.getState().interactive[0].read).toBe(true);
  expect(reportHandledFailure).not.toHaveBeenCalled();
  expect(fetchNotificationsPage).toHaveBeenCalledTimes(1);
});
