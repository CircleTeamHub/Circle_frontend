import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import PostSignupsScreen from './PostSignupsScreen';
import { fetchMyPostSignups, fetchPlazaPost } from '@/services/api/plaza';
import type { PostSignupItem } from '@/types';

jest.mock('react-native', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  const actual = jest.requireActual<typeof import('react-native')>('react-native');
  return new Proxy(actual, { get(target, property, receiver) {
    if (property !== 'FlatList') return Reflect.get(target, property, receiver);
    return ({ onRefresh, refreshing, ListEmptyComponent, data, renderItem }: { onRefresh: () => void; refreshing: boolean; ListEmptyComponent: React.ReactNode; data: PostSignupItem[]; renderItem: (args: { item: PostSignupItem }) => React.ReactNode }) =>
      ReactModule.createElement(actual.View, null,
        ReactModule.createElement(actual.Pressable, { testID: 'list-refresh', onPress: onRefresh, accessibilityState: { busy: refreshing } }),
        ...data.map((item) => ReactModule.createElement(ReactModule.Fragment, { key: item.userId }, renderItem({ item }))),
        data.length === 0 ? ListEmptyComponent : null);
  } });
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), navigate: jest.fn() }),
  useSegments: () => ['(tabs)', 'discover', 'post-signups'],
  useLocalSearchParams: () => ({ postId: 'post-1', title: 'Hike' }),
}));
const mockTranslate = (key: string) => key;
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/theme', () => ({
  Spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  useTheme: () => ({ colors: { background: '#fff', surface: '#fff', surfaceBorder: '#eee', text: '#111', textSecondary: '#666', iconAccent: '#6366F1' } }),
}));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/member-name', () => ({ MemberName: ({ name }: { name: string }) => {
  const { Text } = jest.requireActual('react-native');
  return <Text>{name}</Text>;
} }));
jest.mock('@/components/ui/divider', () => ({ Divider: () => null }));
jest.mock('@/components/ui/user-icon-row', () => ({ UserIconRow: () => null }));
jest.mock('@/services/api/plaza', () => ({
  fetchMyPostSignups: jest.fn(),
  fetchPlazaPost: jest.fn(),
  markMyPostSignupsRead: jest.fn(),
  submitPostCollaborationRecognitions: jest.fn(),
}));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_: unknown, fallback: string) => fallback }));
jest.mock('@/chat-core/client', () => ({ ensureDirectConversation: jest.fn() }));
jest.mock('@/features/chat/store/use-pending-chat-card-store', () => ({
  usePendingChatCardStore: (select: (state: { setPending: () => void }) => unknown) => select({ setPending: jest.fn() }),
}));
jest.mock('@/features/notifications/store/use-notification-center-store', () => ({
  useNotificationCenterStore: { getState: () => ({ markPostSignupsSeenLocal: jest.fn() }) },
}));
jest.mock('@/features/notifications/utils/seen-target', () => ({ markMatchingTargetNotificationsRead: jest.fn() }));
jest.mock('@/stores/tabBadgeStore', () => ({ useTabBadgeStore: { getState: () => ({ signupUnread: 0, setSignupUnread: jest.fn() }) } }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));

type SignupsResult = Awaited<ReturnType<typeof fetchMyPostSignups>>;

beforeEach(() => {
  jest.mocked(fetchMyPostSignups).mockReset();
  jest.mocked(fetchPlazaPost).mockReset().mockReturnValue(new Promise(() => {}));
});

const busy = () => screen.getByTestId('list-refresh').props.accessibilityState.busy;

// iOS 上把 refreshing 设成 true 会把整张列表往下推一截转圈、加载完再弹回去,
// 看起来就是「报名名单从下往上弹」。打开页面的自动加载不能驱动下拉刷新控件。
test('opening the signer list loads without driving the pull-to-refresh control', async () => {
  const first = deferred<SignupsResult>();
  jest.mocked(fetchMyPostSignups).mockReturnValueOnce(first.promise);
  render(<PostSignupsScreen />);
  expect(fetchMyPostSignups).toHaveBeenCalledWith('post-1');
  expect(busy()).toBe(false);
  expect(screen.getByTestId('post-signups-loading')).toBeTruthy();
  // 还没拉到数据时不能先闪一下「还没有人报名」。
  expect(screen.queryByText('notifications.signupMgmt.noSigners')).toBeNull();
  await act(async () => { first.resolve({ items: [signup('Alice')], recognitionOpen: false }); });
  expect(screen.getByText('Alice')).toBeTruthy();
  expect(screen.queryByTestId('post-signups-loading')).toBeNull();
  expect(busy()).toBe(false);
});

test('pulling to refresh the signer list shows the refresh control until it settles', async () => {
  const pulled = deferred<SignupsResult>();
  jest.mocked(fetchMyPostSignups)
    .mockResolvedValueOnce({ items: [signup('Alice')], recognitionOpen: false })
    .mockReturnValueOnce(pulled.promise);
  render(<PostSignupsScreen />);
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText('Alice')).toBeTruthy();
  fireEvent.press(screen.getByTestId('list-refresh'));
  expect(busy()).toBe(true);
  await act(async () => { pulled.resolve({ items: [signup('Alice')], recognitionOpen: false }); });
  expect(busy()).toBe(false);
});

test('an empty signer list shows the empty text once loaded', async () => {
  jest.mocked(fetchMyPostSignups).mockResolvedValueOnce({ items: [], recognitionOpen: false });
  render(<PostSignupsScreen />);
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByTestId('post-signups-loading')).toBeNull();
  expect(screen.getByText('notifications.signupMgmt.noSigners')).toBeTruthy();
});

function signup(nickname: string): PostSignupItem {
  return {
    userId: `user-${nickname}`,
    accountId: nickname.toLowerCase(),
    nickname,
    avatarUrl: null,
    signedAt: '2026-11-07T10:00:00Z',
    seen: true,
    displayIcons: [],
    recognized: false,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
