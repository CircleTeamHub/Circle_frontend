import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import SystemAnnouncementsScreen from './SystemAnnouncementsScreen';
import {
  fetchProfileNotificationsPage,
  markProfileNotificationsRead,
} from '@/services/api/notifications';
import type {
  NotificationCursorPage,
} from '@/services/api/notifications';
import type { NotificationItem } from '@/types';

const mockRouter = { push: jest.fn(), back: jest.fn() };
const mockSetProfileUnread = jest.fn();
let mockAuth = { user: { id: 'account-a' }, sessionEpoch: 1 };
const mockTranslate = (key: string, options?: Record<string, string>) => {
  const translations: Record<string, string> = {
    'systemAnnouncements.title': '系统公告',
    'systemAnnouncements.subtitle': '公告列表',
    'systemAnnouncements.systemNotifications': '账号通知',
    'systemAnnouncements.latestAppInfo.title': '最新 App 信息',
    'systemAnnouncements.latestAppInfo.meta': '风信 1.0.0',
    'systemAnnouncements.latestAppInfo.body': '最新版本摘要',
    'systemAnnouncements.updates.title': '更新',
    'systemAnnouncements.updates.meta': '近期更新',
    'systemAnnouncements.updates.body': '更新摘要',
    'systemAnnouncements.patches.title': '补丁',
    'systemAnnouncements.patches.meta': '维护说明',
    'systemAnnouncements.patches.body': '补丁摘要',
    'notifications.system': '系统通知',
  };
  return String(options?.defaultValue ?? translations[key] ?? key).replace(
    /\{\{(\w+)\}\}/g,
    (_match, name: string) => String(options?.[name] ?? ''),
  );
};

jest.mock('react-native', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  const actual =
    jest.requireActual<typeof import('react-native')>('react-native');
  const FlatList = ({
    data = [],
    renderItem,
    ListHeaderComponent,
    ListFooterComponent,
    onEndReached,
    onRefresh,
  }: {
    data?: NotificationItem[];
    renderItem: (info: { item: NotificationItem }) => React.ReactNode;
    ListHeaderComponent?: React.ReactNode;
    ListFooterComponent?: React.ReactNode;
    onEndReached?: () => void;
    onRefresh?: () => void;
  }) =>
    ReactModule.createElement(
      actual.View,
      null,
      ListHeaderComponent,
      ListFooterComponent,
      onRefresh ? ReactModule.createElement(actual.Pressable,
        { testID: 'mock-flatlist-refresh', onPress: onRefresh },
        ReactModule.createElement(actual.Text, null, 'refresh')) : null,
      ...data.map((item) =>
        ReactModule.createElement(
          ReactModule.Fragment,
          { key: item.id },
          renderItem({ item }),
        ),
      ),
      onEndReached
        ? ReactModule.createElement(
            actual.Pressable,
            { testID: 'mock-flatlist-end', onPress: onEndReached },
            ReactModule.createElement(actual.Text, null, 'load-more'),
          )
        : null,
    );
  return new Proxy(actual, {
    get(target, property, receiver) {
      return property === 'FlatList'
        ? FlatList
        : Reflect.get(target, property, receiver);
    },
  });
});

jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (callback: () => void | (() => void)) => {
      ReactModule.useEffect(() => callback(), [callback]);
    },
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});

jest.mock('@/components/ui/nav-header', () => {
  const { Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return { NavHeader: ({ title }: { title: string }) => <Text>{title}</Text> };
});

jest.mock('@/theme', () => ({
  Radius: { lg: 16 },
  Spacing: { sm: 8, md: 16, lg: 24, xl: 32 },
  Typography: { small: {}, bodyRegular: {}, h3: {} },
  useTheme: () => ({
    colors: {
      background: '#fff',
      surface: '#fff',
      surfaceBorder: '#ddd',
      text: '#111',
      textSecondary: '#666',
      primary: '#6200ee',
    },
  }),
}));

jest.mock('@/services/api/notifications', () => ({
  fetchProfileNotificationsPage: jest.fn(),
  markProfileNotificationsRead: jest.fn(),
}));

jest.mock('@/stores/tabBadgeStore', () => ({
  useTabBadgeStore: (selector: (state: unknown) => unknown) =>
    selector({ setProfileUnread: mockSetProfileUnread }),
}));

jest.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign(
    (selector: (state: typeof mockAuth) => unknown) => selector(mockAuth),
    { getState: () => mockAuth },
  ),
}));

jest.mock('@/features/notifications/utils/report-failure', () => ({
  reportNotificationFailure: jest.fn(),
}));

const mockFetchProfileNotificationsPage =
  fetchProfileNotificationsPage as jest.MockedFunction<
    typeof fetchProfileNotificationsPage
  >;
const mockMarkProfileNotificationsRead =
  markProfileNotificationsRead as jest.MockedFunction<
    typeof markProfileNotificationsRead
  >;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = { user: { id: 'account-a' }, sessionEpoch: 1 };
  mockFetchProfileNotificationsPage.mockResolvedValue({
    items: [],
    nextCursor: null,
  });
  mockMarkProfileNotificationsRead.mockResolvedValue({ count: 0 });
});

const notice = (id: string): NotificationItem => ({
  id, type: 'PROFILE_LIKE', content: id, read: false,
  createdAt: '2026-08-14T12:00:00.000Z', fromUser: null, fromTrace: null,
  fromReply: null, fromCircle: null, fromCirclePost: null, fromInvitation: null,
});

test('a failed refresh keeps cached rows and their pagination cursor', async () => {
  mockFetchProfileNotificationsPage
    .mockResolvedValueOnce({ items: [notice('cached')], nextCursor: 'cached-cursor' })
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ items: [notice('older')], nextCursor: null });
  render(<SystemAnnouncementsScreen />);
  expect(await screen.findByText('cached')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('mock-flatlist-refresh')); });
  expect(screen.getByText('系统通知加载失败，请下拉重试')).toBeTruthy();
  expect(screen.getByText('cached')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('mock-flatlist-end')); });
  expect(mockFetchProfileNotificationsPage).toHaveBeenLastCalledWith('cached-cursor');
  expect(screen.getByText('older')).toBeTruthy();
});

test('multiple end events share one in-flight page and failed pages require explicit retry', async () => {
  const pageRequest = deferred<NotificationCursorPage>();
  mockFetchProfileNotificationsPage
    .mockResolvedValueOnce({ items: [notice('cached')], nextCursor: 'next' })
    .mockReturnValueOnce(pageRequest.promise)
    .mockResolvedValueOnce({ items: [notice('retry-result')], nextCursor: null });
  render(<SystemAnnouncementsScreen />);
  expect(await screen.findByText('cached')).toBeTruthy();
  act(() => {
    fireEvent.press(screen.getByTestId('mock-flatlist-end'));
    fireEvent.press(screen.getByTestId('mock-flatlist-end'));
  });
  expect(mockFetchProfileNotificationsPage).toHaveBeenCalledTimes(2);
  await act(async () => { pageRequest.reject(new Error('offline')); });
  await act(async () => { fireEvent.press(screen.getByTestId('mock-flatlist-end')); });
  expect(mockFetchProfileNotificationsPage).toHaveBeenCalledTimes(2);
  await act(async () => { fireEvent.press(screen.getByText('重试')); });
  expect(mockFetchProfileNotificationsPage).toHaveBeenCalledTimes(3);
  expect(screen.getByText('retry-result')).toBeTruthy();
});

test('a superseded refresh failure cannot replace a successful refresh with an error', async () => {
  const stale = deferred<NotificationCursorPage>();
  mockFetchProfileNotificationsPage
    .mockResolvedValueOnce({ items: [notice('cached')], nextCursor: 'next' })
    .mockReturnValueOnce(stale.promise)
    .mockResolvedValueOnce({ items: [notice('fresh')], nextCursor: null });
  render(<SystemAnnouncementsScreen />);
  expect(await screen.findByText('cached')).toBeTruthy();
  act(() => { fireEvent.press(screen.getByTestId('mock-flatlist-refresh')); });
  await act(async () => { fireEvent.press(screen.getByTestId('mock-flatlist-refresh')); });
  await act(async () => { stale.reject(new Error('old failure')); });
  expect(screen.getByText('fresh')).toBeTruthy();
  expect(screen.queryByText('系统通知加载失败，请下拉重试')).toBeNull();
});

test('a new account immediately hides cached messages even when its refresh fails', async () => {
  mockFetchProfileNotificationsPage
    .mockResolvedValueOnce({ items: [notice('private-a')], nextCursor: 'a-cursor' })
    .mockRejectedValueOnce(new Error('account-b-offline'));
  const view = render(<SystemAnnouncementsScreen />);
  expect(await screen.findByText('private-a')).toBeTruthy();
  mockAuth = { user: { id: 'account-b' }, sessionEpoch: 2 };
  await act(async () => { view.rerender(<SystemAnnouncementsScreen />); });
  expect(screen.queryByText('private-a')).toBeNull();
  await act(async () => { fireEvent.press(screen.getByTestId('mock-flatlist-end')); });
  expect(mockFetchProfileNotificationsPage).toHaveBeenCalledTimes(2);
});

test('old account page and read results cannot change the new account', async () => {
  const oldPage = deferred<NotificationCursorPage>();
  const oldRead = deferred<{ count: number }>();
  mockFetchProfileNotificationsPage
    .mockResolvedValueOnce({ items: [notice('private-a')], nextCursor: 'a-cursor' })
    .mockReturnValueOnce(oldPage.promise)
    .mockResolvedValueOnce({ items: [notice('private-b')], nextCursor: null });
  mockMarkProfileNotificationsRead.mockReturnValueOnce(oldRead.promise);
  const view = render(<SystemAnnouncementsScreen />);
  expect(await screen.findByText('private-a')).toBeTruthy();
  act(() => { fireEvent.press(screen.getByTestId('mock-flatlist-end')); });
  mockAuth = { user: { id: 'account-b' }, sessionEpoch: 2 };
  await act(async () => { view.rerender(<SystemAnnouncementsScreen />); });
  mockSetProfileUnread.mockClear();
  await act(async () => {
    oldPage.resolve({ items: [notice('late-private-a')], nextCursor: 'wrong-cursor' });
    oldRead.resolve({ count: 1 });
  });
  expect(screen.getByText('private-b')).toBeTruthy();
  expect(screen.queryByText('late-private-a')).toBeNull();
  expect(mockSetProfileUnread).not.toHaveBeenCalled();
});

test('opens a static announcement detail and hides the empty account-notification section', async () => {
  const request = deferred<NotificationCursorPage>();
  mockFetchProfileNotificationsPage.mockReturnValue(request.promise);
  render(<SystemAnnouncementsScreen />);

  await act(async () => {
    request.resolve({ items: [], nextCursor: null });
  });

  await waitFor(() =>
    expect(mockFetchProfileNotificationsPage).toHaveBeenCalledWith(),
  );
  fireEvent.press(screen.getByLabelText('查看最新 App 信息详情'));

  expect(mockRouter.push).toHaveBeenCalledWith({
    pathname: '/(tabs)/profile/system-announcements/[id]',
    params: { id: 'latestAppInfo' },
  });
  expect(screen.queryByText('账号通知')).toBeNull();
  expect(screen.queryByText('暂无系统通知')).toBeNull();
});

test('labels backend-delivered profile messages as account notifications', async () => {
  const notification: NotificationItem = {
    id: 'notice-1',
    type: 'PROFILE_LIKE',
    content: '你的账号安全设置已更新',
    read: false,
    createdAt: '2026-08-14T12:00:00.000Z',
    fromUser: null,
    fromTrace: null,
    fromReply: null,
    fromCircle: null,
    fromCirclePost: null,
    fromInvitation: null,
  };
  const request = deferred<NotificationCursorPage>();
  mockFetchProfileNotificationsPage.mockReturnValue(request.promise);
  render(<SystemAnnouncementsScreen />);

  await act(async () => {
    request.resolve({ items: [notification], nextCursor: null });
  });

  expect(await screen.findByText('账号通知')).toBeTruthy();
  expect(screen.getByText('你的账号安全设置已更新')).toBeTruthy();
});

test('follows the profile notification cursor when the list reaches the end', async () => {
  const first: NotificationItem = {
    id: 'notice-1',
    type: 'PROFILE_LIKE',
    content: '第一页',
    read: false,
    createdAt: '2026-08-14T12:00:00.000Z',
    fromUser: null,
    fromTrace: null,
    fromReply: null,
    fromCircle: null,
    fromCirclePost: null,
    fromInvitation: null,
  };
  const second = { ...first, id: 'notice-2', content: '第二页' };
  mockFetchProfileNotificationsPage
    .mockResolvedValueOnce({ items: [first], nextCursor: 'cursor-1' })
    .mockResolvedValueOnce({ items: [second], nextCursor: null });

  render(<SystemAnnouncementsScreen />);
  expect(await screen.findByText('第一页')).toBeTruthy();

  await act(async () => {
    fireEvent.press(screen.getByTestId('mock-flatlist-end'));
  });

  await waitFor(() =>
    expect(mockFetchProfileNotificationsPage).toHaveBeenNthCalledWith(
      2,
      'cursor-1',
    ),
  );
  expect(await screen.findByText('第二页')).toBeTruthy();
});
