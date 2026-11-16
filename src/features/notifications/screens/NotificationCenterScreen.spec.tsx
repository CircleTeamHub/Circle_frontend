import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ActivityIndicator } from 'react-native';
import NotificationCenterScreen from './NotificationCenterScreen';
import { fetchNotificationsPage, markAllNotificationsRead, markNotificationRead, markTraceLikesRead } from '@/services/api/notifications';
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
  groupNoticeUnread: 0, profileUnread: 0, contactsUnread: 0, groupAdmissionsUnread: 0,
  setDiscoverUnread: jest.fn((count) => { mockBadges.discoverUnread = count; }),
  setMomentsUnread: jest.fn((count) => { mockBadges.momentsUnread = count; }),
  setCircleUnread: jest.fn((count) => { mockBadges.circleUnread = count; }),
  setSignupUnread: jest.fn((count) => { mockBadges.signupUnread = count; }),
  setGroupNoticeUnread: jest.fn((count) => { mockBadges.groupNoticeUnread = count; }),
  setProfileUnread: jest.fn((count) => { mockBadges.profileUnread = count; }),
};
jest.mock('@/stores/authStore', () => {
  const { create } = jest.requireActual('zustand');
  return { useAuthStore: create(() => ({ user: { id: 'account-a' }, isAuthenticated: true, sessionEpoch: 1 })) };
});
const mockRouter = { back: jest.fn(), push: jest.fn(), navigate: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useSegments: () => mockSegments, usePathname: () => '/messages/notifications', useLocalSearchParams: () => ({ domain: mockDomain }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock('react-native', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  const actual = jest.requireActual<typeof import('react-native')>('react-native');
  return new Proxy(actual, { get(target, property, receiver) {
    if (property !== 'FlatList') return Reflect.get(target, property, receiver);
    return ({ onEndReached, onRefresh, refreshing, ListHeaderComponent, ListFooterComponent, ListEmptyComponent, data, renderItem }: { onEndReached: () => void; onRefresh: () => void; refreshing: boolean; ListHeaderComponent?: React.ReactNode; ListFooterComponent: React.ReactNode; ListEmptyComponent: React.ReactNode; data: { view: { id: string } }[]; renderItem: (args: { item: { view: { id: string } } }) => React.ReactNode }) =>
      ReactModule.createElement(actual.View, null,
        ListHeaderComponent ?? null,
        ReactModule.createElement(actual.Pressable, { testID: 'list-end', onPress: onEndReached }),
        ReactModule.createElement(actual.Pressable, { testID: 'list-refresh', onPress: onRefresh, accessibilityState: { busy: refreshing } }),
        ...data.map((item) => ReactModule.createElement(ReactModule.Fragment, { key: item.view.id }, renderItem({ item }))),
        data.length === 0 ? ListEmptyComponent : null,
        ListFooterComponent);
  } });
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/theme', () => ({
  Spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  Radius: { full: 9999 },
  useTheme: () => ({ colors: { background: '#fff', surface: '#fff', text: '#111', textSecondary: '#666', primary: '#6200ee' } }),
}));
jest.mock('@/components/ui/divider', () => ({ Divider: () => null }));
jest.mock('@/features/notifications/components/NotificationTabBar', () => ({ NotificationTabBar: ({ onSelect }: { onSelect: (tab: string) => void }) => {
  const { Pressable, View } = jest.requireActual('react-native');
  return <View>
    <Pressable testID="signup-tab" onPress={() => onSelect('signups')} />
    <Pressable testID="notifications-tab" onPress={() => onSelect('notifications')} />
    {['notice', 'moments', 'group', 'system'].map((key) => (
      <Pressable key={key} testID={`tab-${key}`} onPress={() => onSelect(key)} />
    ))}
  </View>;
} }));
jest.mock('@/features/notifications/components/ReadFilterBar', () => ({ ReadFilterBar: ({ onMarkAll }: { onMarkAll: () => void }) => {
  const { Pressable } = jest.requireActual('react-native');
  return <Pressable testID="mark-all" onPress={onMarkAll} />;
} }));
jest.mock('@/features/notifications/components/NotificationRow', () => ({ NotificationRow: ({ data, onPress }: { data: { id: string }; onPress: () => void }) => {
  const { Text } = jest.requireActual('react-native');
  return <Text onPress={onPress}>{data.id}</Text>;
} }));
jest.mock('@/features/notifications/components/NotificationEmptyState', () => ({ NotificationEmptyState: () => null }));
jest.mock('@/services/api/notifications', () => ({ fetchNotificationsPage: jest.fn(), markAllNotificationsRead: jest.fn(), markNotificationRead: jest.fn(), markTraceLikesRead: jest.fn() }));
jest.mock('@/services/api/plaza', () => ({ fetchAllMyCirclePosts: jest.fn(), markMyPostSignupsRead: jest.fn() }));
jest.mock('@/stores/tabBadgeStore', () => ({
  useTabBadgeStore: Object.assign(
    (selector: (state: typeof mockBadges) => unknown) => selector(mockBadges),
    { getState: () => mockBadges },
  ),
}));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchNotificationsPage).mockReset();
  jest.mocked(fetchAllMyCirclePosts).mockReset().mockResolvedValue([]);
  jest.mocked(markAllNotificationsRead).mockReset();
  jest.mocked(markMyPostSignupsRead).mockReset();
  mockDomain = 'moments';
  mockSegments.splice(0, mockSegments.length, '(tabs)', 'messages');
  useAuthStore.setState({ user: { id: 'account-a' } as AuthUser, isAuthenticated: true, sessionEpoch: 1 });
  useNotificationCenterStore.getState().reset();
  useNotificationCenterStore.setState({ appendInteractivePage: mockAppendPage });
  Object.assign(mockBadges, {
    discoverUnread: 0, momentsUnread: 0, circleUnread: 0, signupUnread: 0,
    groupNoticeUnread: 0, profileUnread: 0, contactsUnread: 0, groupAdmissionsUnread: 0,
  });
});

test('the circle notifications page carries the settings gear and opens settings in the same tab', async () => {
  jest.mocked(fetchNotificationsPage).mockResolvedValue({ items: [], nextCursor: null });
  mockDomain = 'circle';
  const view = render(<NotificationCenterScreen />);
  await act(async () => { await Promise.resolve(); });
  // 消息页的飞机进来：留在消息栈。
  fireEvent.press(screen.getByRole('button', { name: 'discover.notifications.title' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/(tabs)/messages/circle-notifications');

  // 圈子动态的铃铛进来：留在发现栈。
  view.unmount();
  mockSegments.splice(0, mockSegments.length, '(tabs)', 'discover', 'notification-center');
  render(<NotificationCenterScreen />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.press(screen.getByRole('button', { name: 'discover.notifications.title' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/(tabs)/discover/notifications');
});

test('likes on one moment show as one row and are marked read together', async () => {
  const like = (id: string, userId: string): NotificationItem => ({
    id, type: 'TRACE_LIKE', content: '', read: false, createdAt: '2026-11-16T00:00:00.000Z',
    fromUser: { id: userId, nickname: userId, avatarUrl: null },
    fromTrace: { id: 'trace-1', excerpt: '', firstImage: null },
    fromReply: null, fromCircle: null, fromCirclePost: null, fromInvitation: null,
  });
  jest.mocked(fetchNotificationsPage).mockResolvedValue({
    items: [like('like-2', 'u2'), like('like-1', 'u1')], nextCursor: null,
  });
  jest.mocked(markTraceLikesRead).mockResolvedValue(undefined);
  mockBadges.momentsUnread = 2;
  mockBadges.discoverUnread = 2;
  render(<NotificationCenterScreen />);

  fireEvent.press(await screen.findByText('like-2'));

  expect(screen.queryByText('like-1')).toBeNull();
  expect(markTraceLikesRead).toHaveBeenCalledWith('trace-1');
  expect(markNotificationRead).not.toHaveBeenCalled();
  expect(mockBadges.momentsUnread).toBe(0);
  expect(useNotificationCenterStore.getState().interactive.every((n) => n.read)).toBe(true);
});

test('the moments notifications page has no circle settings gear', async () => {
  jest.mocked(fetchNotificationsPage).mockResolvedValue({ items: [], nextCursor: null });
  render(<NotificationCenterScreen />);
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByRole('button', { name: 'discover.notifications.title' })).toBeNull();
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
  fireEvent.press(screen.getByTestId('notifications-tab'));
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
  fireEvent.press(screen.getByTestId('notifications-tab'));
  await act(async () => { await Promise.resolve(); });
  fireEvent.press(screen.getByTestId('list-end'));
  expect(screen.UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  fireEvent.press(screen.getByTestId('signup-tab'));
  expect(screen.UNSAFE_queryByType(ActivityIndicator)).toBeNull();
  expect(screen.queryByRole('button', { name: 'common.retry' })).toBeNull();
  await act(async () => {
    if (outcome === 'success') page.resolve({ items: [notification('background-page', 'CIRCLE_POST_AUTO_ENDED')], nextCursor: null });
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
  fireEvent.press(screen.getByTestId('notifications-tab'));
  await act(async () => { await Promise.resolve(); });
  fireEvent.press(screen.getByTestId('list-end'));
  fireEvent.press(screen.getByTestId('signup-tab'));
  fireEvent.press(screen.getByTestId('list-refresh'));
  await act(async () => { await Promise.resolve(); });
  fireEvent.press(screen.getByTestId('notifications-tab'));
  fireEvent.press(screen.getByTestId('list-end'));
  expect(fetchNotificationsPage).toHaveBeenLastCalledWith('fresh-cursor', 'circle');
  expect(screen.UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  await act(async () => { old.resolve({ items: [notification('stale-page', 'CIRCLE_POST_AUTO_ENDED')], nextCursor: null }); });
  expect(screen.UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  expect(mockAppendPage).not.toHaveBeenCalled();
  await act(async () => { current.resolve({ items: [notification('current-page', 'CIRCLE_POST_AUTO_ENDED')], nextCursor: null }); });
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

// iOS 上把 refreshing 设成 true 会把整张列表往下推一截转圈、加载完再弹回去,
// 看起来就是「内容从下往上弹」。打开页面的自动加载不能驱动下拉刷新控件。
test('opening the screen loads without driving the pull-to-refresh control', async () => {
  const first = deferred<Awaited<ReturnType<typeof fetchNotificationsPage>>>();
  jest.mocked(fetchNotificationsPage).mockReturnValueOnce(first.promise);
  render(<NotificationCenterScreen />);
  expect(fetchNotificationsPage).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('list-refresh').props.accessibilityState.busy).toBe(false);
  expect(screen.getByTestId('notification-center-loading')).toBeTruthy();
  await act(async () => { first.resolve({ items: [notification('loaded')], nextCursor: null }); });
  expect(screen.getByText('loaded')).toBeTruthy();
  expect(screen.queryByTestId('notification-center-loading')).toBeNull();
  expect(screen.getByTestId('list-refresh').props.accessibilityState.busy).toBe(false);
});

test('cached rows stay in place while the opening load runs', async () => {
  useNotificationCenterStore.getState().setInteractiveForDomain('moments', [notification('cached')]);
  const first = deferred<Awaited<ReturnType<typeof fetchNotificationsPage>>>();
  jest.mocked(fetchNotificationsPage).mockReturnValueOnce(first.promise);
  render(<NotificationCenterScreen />);
  expect(screen.getByText('cached')).toBeTruthy();
  expect(screen.queryByTestId('notification-center-loading')).toBeNull();
  expect(screen.getByTestId('list-refresh').props.accessibilityState.busy).toBe(false);
  await act(async () => { first.resolve({ items: [notification('cached')], nextCursor: null }); });
});

test('pulling to refresh shows the refresh control until the load settles', async () => {
  const pulled = deferred<Awaited<ReturnType<typeof fetchNotificationsPage>>>();
  jest.mocked(fetchNotificationsPage).mockResolvedValueOnce({ items: [], nextCursor: null })
    .mockReturnValueOnce(pulled.promise);
  render(<NotificationCenterScreen />);
  await waitFor(() => expect(screen.queryByTestId('notification-center-loading')).toBeNull());
  fireEvent.press(screen.getByTestId('list-refresh'));
  expect(screen.getByTestId('list-refresh').props.accessibilityState.busy).toBe(true);
  // 下拉时顶部已经在转圈,列表中间不再叠一个。
  expect(screen.queryByTestId('notification-center-loading')).toBeNull();
  await act(async () => { pulled.resolve({ items: [], nextCursor: null }); });
  expect(screen.getByTestId('list-refresh').props.accessibilityState.busy).toBe(false);
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

// 没有专属落点的通知兜底回通知列表 —— 也就是正开着的这一页,只标已读,不再叠一层列表。
test('a notification without its own destination does not stack another notification list', async () => {
  jest.mocked(markNotificationRead).mockResolvedValue(undefined);
  jest.mocked(fetchNotificationsPage).mockResolvedValueOnce({ items: [notification('no-target')], nextCursor: null });
  render(<NotificationCenterScreen />);
  fireEvent.press(await screen.findByText('no-target'));
  expect(markNotificationRead).toHaveBeenCalledWith('no-target');
  expect(mockRouter.push).not.toHaveBeenCalled();
  expect(mockRouter.navigate).not.toHaveBeenCalled();
});

test('a notification with its own destination still opens it', async () => {
  jest.mocked(markNotificationRead).mockResolvedValue(undefined);
  const liked = { ...notification('liked'), fromTrace: { id: 'trace-1', excerpt: 'x', firstImage: null } };
  jest.mocked(fetchNotificationsPage).mockResolvedValueOnce({ items: [liked], nextCursor: null });
  render(<NotificationCenterScreen />);
  fireEvent.press(await screen.findByText('liked'));
  // 这一页开在消息栈里:动态详情也开在消息栈,返回回到这一页(而不是探索 tab 首页)。
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/(tabs)/messages/moment/[id]', params: { id: 'trace-1' } });
});

// ---- 消息页「通知」:圈子以外的知会,四个分类 ----

test('the message-page notices open on every category at once and switch by category domain', async () => {
  mockDomain = 'notice';
  jest.mocked(fetchNotificationsPage).mockResolvedValue({ items: [], nextCursor: null });
  render(<NotificationCenterScreen />);
  await waitFor(() => expect(fetchNotificationsPage).toHaveBeenCalledWith(undefined, 'notice'));
  // 不是圈子:没有报名管理,也不为它拉数据。
  expect(fetchAllMyCirclePosts).not.toHaveBeenCalled();

  fireEvent.press(screen.getByTestId('tab-group'));
  await waitFor(() => expect(fetchNotificationsPage).toHaveBeenLastCalledWith(undefined, 'group'));
  fireEvent.press(screen.getByTestId('tab-system'));
  await waitFor(() => expect(fetchNotificationsPage).toHaveBeenLastCalledWith(undefined, 'system'));
});

test('friend and group requests get a shortcut into their own inbox instead of copied rows', async () => {
  mockDomain = 'notice';
  Object.assign(mockBadges, { contactsUnread: 2, groupAdmissionsUnread: 1 });
  jest.mocked(fetchNotificationsPage).mockResolvedValue({ items: [], nextCursor: null });
  render(<NotificationCenterScreen />);
  // 这里的 FlatList 替身每次渲染都是新组件类型(列表子树会重挂):等加载落定再取再按。
  await waitFor(() => expect(fetchNotificationsPage).toHaveBeenCalled());
  await act(async () => { await Promise.resolve(); });
  fireEvent.press(screen.getByTestId('notice-new-friends-shortcut'));
  // 留在消息栈:跳去通讯录 tab 的话,返回停在通讯录首页而不是这一页。
  expect(mockRouter.push).toHaveBeenCalledWith('/(tabs)/messages/new-friends');

  // 互动 / 系统分类里没有这个入口。
  fireEvent.press(screen.getByTestId('tab-moments'));
  await waitFor(() => expect(screen.queryByTestId('notice-new-friends-shortcut')).toBeNull());
});

test('a removed-from-group notice is marked read where it is and leads nowhere', async () => {
  mockDomain = 'notice';
  mockBadges.groupNoticeUnread = 1;
  jest.mocked(markNotificationRead).mockResolvedValue(undefined);
  jest.mocked(fetchNotificationsPage).mockResolvedValue({
    items: [notification('removed-1', 'GROUP_MEMBER_REMOVED')],
    nextCursor: null,
  });
  render(<NotificationCenterScreen />);
  fireEvent.press(await screen.findByText('removed-1'));
  expect(markNotificationRead).toHaveBeenCalledWith('removed-1');
  // 群已经不在了:不跳转,也不会兜底叠出第二个通知列表。
  expect(mockRouter.push).not.toHaveBeenCalled();
  expect(mockRouter.navigate).not.toHaveBeenCalled();
  // 扣的是群聊知会那一份,不碰两个铃铛的计数。
  expect(mockBadges.setGroupNoticeUnread).toHaveBeenCalledWith(0);
  expect(mockBadges.setDiscoverUnread).not.toHaveBeenCalled();
});

test('marking all notices read clears notices and announcements but never the circle bell', async () => {
  mockDomain = 'notice';
  Object.assign(mockBadges, { momentsUnread: 3, groupNoticeUnread: 1, profileUnread: 2, circleUnread: 4 });
  jest.mocked(markAllNotificationsRead).mockResolvedValue({ count: 6 });
  jest.mocked(fetchNotificationsPage).mockResolvedValue({ items: [], nextCursor: null });
  render(<NotificationCenterScreen />);
  await waitFor(() => expect(fetchNotificationsPage).toHaveBeenCalled());
  await act(async () => { fireEvent.press(screen.getByTestId('mark-all')); });
  expect(markAllNotificationsRead).toHaveBeenCalledWith('notice');
  expect(mockBadges.momentsUnread).toBe(0);
  expect(mockBadges.groupNoticeUnread).toBe(0);
  expect(mockBadges.profileUnread).toBe(0);
  expect(mockBadges.circleUnread).toBe(4);
});

