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
  fetchProfileNotifications,
  markProfileNotificationsRead,
} from '@/services/api/notifications';
import type { NotificationItem } from '@/types';

const mockRouter = { push: jest.fn(), back: jest.fn() };
const mockSetProfileUnread = jest.fn();
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
    }: {
      data?: NotificationItem[];
      renderItem: (info: { item: NotificationItem }) => React.ReactNode;
      ListHeaderComponent?: React.ReactNode;
    }) =>
    ReactModule.createElement(
      actual.View,
      null,
      ListHeaderComponent,
      ...data.map((item) =>
        ReactModule.createElement(
          ReactModule.Fragment,
          { key: item.id },
          renderItem({ item }),
        ),
      ),
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
  fetchProfileNotifications: jest.fn(),
  markProfileNotificationsRead: jest.fn(),
}));

jest.mock('@/stores/tabBadgeStore', () => ({
  useTabBadgeStore: (selector: (state: unknown) => unknown) =>
    selector({ setProfileUnread: mockSetProfileUnread }),
}));

jest.mock('@/features/notifications/utils/report-failure', () => ({
  reportNotificationFailure: jest.fn(),
}));

const mockFetchProfileNotifications =
  fetchProfileNotifications as jest.MockedFunction<
    typeof fetchProfileNotifications
  >;
const mockMarkProfileNotificationsRead =
  markProfileNotificationsRead as jest.MockedFunction<
    typeof markProfileNotificationsRead
  >;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchProfileNotifications.mockResolvedValue([]);
  mockMarkProfileNotificationsRead.mockResolvedValue({ count: 0 });
});

test('opens a static announcement detail and hides the empty account-notification section', async () => {
  const request = deferred<NotificationItem[]>();
  mockFetchProfileNotifications.mockReturnValue(request.promise);
  render(<SystemAnnouncementsScreen />);

  await act(async () => {
    request.resolve([]);
  });

  await waitFor(() => expect(mockFetchProfileNotifications).toHaveBeenCalled());
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
  const request = deferred<NotificationItem[]>();
  mockFetchProfileNotifications.mockReturnValue(request.promise);
  render(<SystemAnnouncementsScreen />);

  await act(async () => {
    request.resolve([notification]);
  });

  expect(await screen.findByText('账号通知')).toBeTruthy();
  expect(screen.getByText('你的账号安全设置已更新')).toBeTruthy();
});
