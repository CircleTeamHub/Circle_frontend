import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import PostSignupsScreen from './PostSignupsScreen';
import { fetchMyPostSignups, fetchMyPlazaPost, updateMyPlazaPost } from '@/services/api/plaza';
import { ensureDirectConversation } from '@/chat-core/client';
import type { CirclePlazaPost, PostSignupItem } from '@/types';

jest.mock('react-native', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  const actual = jest.requireActual<typeof import('react-native')>('react-native');
  return new Proxy(actual, { get(target, property, receiver) {
    if (property !== 'FlatList') return Reflect.get(target, property, receiver);
    return ({ onRefresh, refreshing, ListHeaderComponent, ListEmptyComponent, data, renderItem }: { onRefresh: () => void; refreshing: boolean; ListHeaderComponent: React.ReactNode; ListEmptyComponent: React.ReactNode; data: PostSignupItem[]; renderItem: (args: { item: PostSignupItem }) => React.ReactNode }) =>
      ReactModule.createElement(actual.View, null,
        ReactModule.createElement(actual.Pressable, { testID: 'list-refresh', onPress: onRefresh, accessibilityState: { busy: refreshing } }),
        ListHeaderComponent,
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
jest.mock('@/features/discover/components/plaza-post-card', () => ({
  PlazaPostCard: ({ post, onEdit }: { post: CirclePlazaPost; onEdit: () => void }) => {
    const { Pressable, Text } = jest.requireActual<typeof import('react-native')>('react-native');
    return <><Text>{post.content}</Text><Pressable testID="edit-post" onPress={onEdit} /></>;
  },
}));
jest.mock('@/features/discover/store/use-discover-store', () => ({
  useDiscoverStore: { getState: () => ({ updatePlazaPostContent: jest.fn() }) },
}));
jest.mock('@/services/api/plaza', () => ({
  fetchMyPostSignups: jest.fn(),
  fetchMyPlazaPost: jest.fn(),
  updateMyPlazaPost: jest.fn(),
  markMyPostSignupsRead: jest.fn(),
  submitPostCollaborationRecognitions: jest.fn(),
}));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_: unknown, fallback: string) => fallback }));
jest.mock('@/chat-core/client', () => ({ ensureDirectConversation: jest.fn() }));
jest.mock('@/features/chat/store/use-pending-chat-card-store', () => ({
  usePendingChatCardStore: (select: (state: { setPending: () => void }) => unknown) => select({ setPending: jest.fn() }),
}));
jest.mock('@/features/notifications/store/use-notification-center-store', () => ({
  useNotificationCenterStore: { getState: () => ({ markPostSignupsSeenLocal: jest.fn(), updateSignupPostExcerpt: jest.fn() }) },
}));
jest.mock('@/features/notifications/utils/seen-target', () => ({ markMatchingTargetNotificationsRead: jest.fn() }));
jest.mock('@/stores/tabBadgeStore', () => ({ useTabBadgeStore: { getState: () => ({ signupUnread: 0, setSignupUnread: jest.fn() }) } }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => ({ sessionEpoch: 1 }) } }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/components/ui/badge', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Badge: ({ count }: { count: number }) => <Text testID="unread-badge">{count}</Text> };
});
let mockChatConversations: { id: string; type: string; peer?: { id: string }; preview: string; unreadCount: number }[] = [];
jest.mock('@/chat-core/store', () => ({
  useChatStore: (select: (state: { conversations: unknown[] }) => unknown) => select({ conversations: mockChatConversations }),
}));
jest.mock('@/chat-core/mappers', () => ({
  mapChatConversationToUI: (dto: { id: string; preview: string; unreadCount: number }) => ({
    id: dto.id, message: dto.preview, time: '10:30', unreadCount: dto.unreadCount,
  }),
}));

type SignupsResult = Awaited<ReturnType<typeof fetchMyPostSignups>>;

beforeEach(() => {
  mockChatConversations = [];
  jest.mocked(fetchMyPostSignups).mockReset();
  jest.mocked(fetchMyPlazaPost).mockReset().mockReturnValue(new Promise(() => {}));
  jest.mocked(updateMyPlazaPost).mockReset();
});

const busy = () => screen.getByTestId('list-refresh').props.accessibilityState.busy;

test('shows the authored post above its signers and updates the same post after editing', async () => {
  jest.mocked(fetchMyPlazaPost).mockResolvedValue({ id: 'post-1', content: 'Original hiking plans' } as CirclePlazaPost);
  jest.mocked(fetchMyPostSignups).mockResolvedValue({ items: [signup('Alice')], recognitionOpen: false });
  jest.mocked(updateMyPlazaPost).mockResolvedValue(undefined);
  render(<PostSignupsScreen />);

  expect(await screen.findByText('Original hiking plans')).toBeTruthy();
  expect(screen.getByText('Alice')).toBeTruthy();
  fireEvent.press(screen.getByTestId('edit-post'));
  fireEvent.changeText(screen.getByDisplayValue('Original hiking plans'), 'Updated hiking plans');
  fireEvent.press(screen.getByText('common.save'));

  expect(await screen.findByText('Updated hiking plans')).toBeTruthy();
  expect(updateMyPlazaPost).toHaveBeenCalledWith('post-1', 'Updated hiking plans');
  expect(screen.getByText('Alice')).toBeTruthy();
});

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
  jest.mocked(fetchMyPlazaPost).mockResolvedValue({ id: 'post-1', content: 'Hike' } as CirclePlazaPost);
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

test('signers read like the messages list: last chat line, time and unread, and the row opens the chat', async () => {
  mockChatConversations = [
    { id: 'dm-alice', type: 'DIRECT', peer: { id: 'user-Alice' }, preview: '几点集合？', unreadCount: 2 },
    // A group chat with the same person must not be mistaken for the direct chat.
    { id: 'group-x', type: 'GROUP', peer: { id: 'user-Bob' }, preview: '群消息', unreadCount: 5 },
  ];
  jest.mocked(ensureDirectConversation).mockResolvedValue({ conversationID: 'dm-alice' } as never);
  jest.mocked(fetchMyPostSignups).mockResolvedValueOnce({ items: [signup('Alice'), signup('Bob')], recognitionOpen: false });
  render(<PostSignupsScreen />);
  await act(async () => { await Promise.resolve(); });

  expect(screen.getByText('几点集合？')).toBeTruthy();
  expect(screen.getByText('10:30')).toBeTruthy();
  expect(screen.getByTestId('unread-badge')).toHaveTextContent('2');
  // Never chatted yet: the preview falls back to when they signed up.
  expect(screen.getByText('notifications.signupMgmt.signedAt')).toBeTruthy();
  expect(screen.queryByText('群消息')).toBeNull();

  await act(async () => { fireEvent.press(screen.getByText('几点集合？')); });
  expect(ensureDirectConversation).toHaveBeenCalledWith('user-Alice');
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
