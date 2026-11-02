import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import NewFriendsScreen from './NewFriendsScreen';
import { fetchFriendActivities, type FriendActivity } from '@/services/api/friends';

const mockTranslate = (key: string) => key;
let mockFriendsMutated = false;
let mockSessionEpoch = 1;
let mockFocusCallback: (() => void | (() => void)) | null = null;

jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => ({ push: jest.fn() }),
    useFocusEffect: (callback: () => void | (() => void)) => {
      mockFocusCallback = callback;
      ReactModule.useEffect(() => callback(), [callback]);
    },
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate, i18n: { language: 'zh' } }),
}));
jest.mock('@/i18n', () => ({
  __esModule: true,
  default: { t: (key: string) => key, language: 'zh' },
}));
jest.mock('@/theme', () => ({
  Spacing: { md: 8, lg: 16, xl: 24 },
  Typography: { body: {}, bodyRegular: {}, small: {}, tiny: {} },
  useTheme: () => ({
    colors: {
      background: '#fff', surface: '#fff', text: '#111',
      textSecondary: '#666', primary: '#00f', white: '#fff',
    },
  }),
}));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/divider', () => ({ Divider: () => null }));
jest.mock('@/components/ui/unread-count-badge', () => ({ UnreadCountBadge: () => null }));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/components/ui/member-name', () => {
  const { Text: MockText } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return { MemberName: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});
jest.mock('@/features/contacts/components/InboxTabsHeader', () => ({
  InboxTabsHeader: () => null,
}));
jest.mock('@/features/contacts/components/NewGroupsInboxList', () => ({
  NewGroupsInboxList: () => null,
}));
jest.mock('@/features/contacts/utils/mark-friend-activities-read', () => ({
  markFriendActivitiesRead: jest.fn(),
}));
jest.mock('@/features/user/utils/routes', () => ({
  getFriendActivityDetailHref: (id: string) => id,
}));
jest.mock('@/features/notifications/utils/seen-target', () => ({
  markMatchingTargetNotificationsRead: jest.fn(async () => undefined),
}));
jest.mock('@/services/api/friends', () => ({
  fetchFriendActivities: jest.fn(),
  friendsMutatedSince: () => mockFriendsMutated,
}));
// 与真 store 一样返回稳定的 refresh:每次渲染换新引用会让聚焦回调反复重跑。
jest.mock('@/stores/friendActivityUnreadStore', () => {
  const state = { count: 0, refresh: async () => 0 };
  return {
    useFriendActivityUnreadStore: (select: (current: typeof state) => unknown) =>
      select(state),
  };
});
jest.mock('@/stores/tabBadgeStore', () => ({
  useTabBadgeStore: (select: (state: { groupAdmissionsUnread: number }) => unknown) =>
    select({ groupAdmissionsUnread: 0 }),
}));
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (select: (state: { sessionEpoch: number }) => unknown) =>
    select({ sessionEpoch: mockSessionEpoch }),
}));

function activity(nickname: string): FriendActivity {
  return {
    id: `activity-${nickname}`,
    type: 'REQUEST_RECEIVED',
    requestId: `request-${nickname}`,
    requestState: 'PENDING',
    messageSnapshot: null,
    readAt: null,
    createdAt: '2026-10-31T08:00:00.000Z',
    counterparty: {
      id: `user-${nickname}`,
      accountId: nickname,
      nickname,
      avatarUrl: null,
      avatarFrameAppearance: null,
    },
  };
}

async function visitOnce(activities: FriendActivity[]) {
  jest.mocked(fetchFriendActivities).mockResolvedValueOnce(activities);
  const view = render(<NewFriendsScreen />);
  if (activities.length > 0) {
    await screen.findByText(activities[0].counterparty.nickname);
  } else {
    await screen.findByText('contacts.friendActivity.empty');
  }
  view.unmount();
}

beforeEach(() => {
  mockFriendsMutated = false;
  mockSessionEpoch += 1;
  jest.mocked(fetchFriendActivities).mockReset();
});

test('the first visit spins until the list arrives', () => {
  jest.mocked(fetchFriendActivities).mockReturnValue(new Promise(() => {}));
  render(<NewFriendsScreen />);
  expect(screen.getByText('contacts.friendActivity.loading')).toBeTruthy();
});

// 进进出出不再每次整页转圈:先画上次的列表,后台照常重拉。
test('a second visit shows the last loaded list at once and refreshes behind it', async () => {
  await visitOnce([activity('阿青')]);

  jest.mocked(fetchFriendActivities).mockResolvedValueOnce([
    activity('阿青'),
    activity('小林'),
  ]);
  render(<NewFriendsScreen />);

  expect(screen.getByText('阿青')).toBeTruthy();
  expect(screen.queryByText('contacts.friendActivity.loading')).toBeNull();
  expect(await screen.findByText('小林')).toBeTruthy();
  expect(fetchFriendActivities).toHaveBeenCalledTimes(2);
});

test('a cached empty inbox says so instead of spinning', async () => {
  await visitOnce([]);

  jest.mocked(fetchFriendActivities).mockReturnValue(new Promise(() => {}));
  render(<NewFriendsScreen />);

  expect(screen.getByText('contacts.friendActivity.empty')).toBeTruthy();
  expect(screen.queryByText('contacts.friendActivity.loading')).toBeNull();
});

// 详情页同意/拒绝之后没回列表就走了:旧列表会把已处理的申请画回「待处理」,宁可转圈。
test('a friend write after the last load means the old list is not shown', async () => {
  await visitOnce([activity('阿青')]);

  mockFriendsMutated = true;
  jest.mocked(fetchFriendActivities).mockReturnValue(new Promise(() => {}));
  render(<NewFriendsScreen />);

  expect(screen.queryByText('阿青')).toBeNull();
  expect(screen.getByText('contacts.friendActivity.loading')).toBeTruthy();
});

test('another account never sees the previous account list', async () => {
  await visitOnce([activity('阿青')]);

  mockSessionEpoch += 1;
  jest.mocked(fetchFriendActivities).mockReturnValue(new Promise(() => {}));
  render(<NewFriendsScreen />);

  expect(screen.queryByText('阿青')).toBeNull();
  expect(screen.getByText('contacts.friendActivity.loading')).toBeTruthy();
});

test('a failed refresh keeps the cached list on screen', async () => {
  await visitOnce([activity('阿青')]);

  jest.mocked(fetchFriendActivities).mockRejectedValueOnce(new Error('offline'));
  render(<NewFriendsScreen />);

  await waitFor(() => expect(fetchFriendActivities).toHaveBeenCalledTimes(2));
  expect(screen.getByText('阿青')).toBeTruthy();
});

// 同意/拒绝在详情页做(记好友写请求):回到列表必须重拉,不能停在「待处理」;只是看了看就回来则不重拉。
test('returning from the detail page reloads only after a friend write', async () => {
  jest.mocked(fetchFriendActivities).mockResolvedValueOnce([activity('阿青')]);
  render(<NewFriendsScreen />);
  await screen.findByText('阿青');

  await act(async () => {
    mockFocusCallback?.();
    await Promise.resolve();
  });
  expect(fetchFriendActivities).toHaveBeenCalledTimes(1);

  mockFriendsMutated = true;
  jest.mocked(fetchFriendActivities).mockResolvedValueOnce([activity('小林')]);
  await act(async () => {
    mockFocusCallback?.();
    await Promise.resolve();
  });
  expect(await screen.findByText('小林')).toBeTruthy();
  expect(fetchFriendActivities).toHaveBeenCalledTimes(2);
});

test('a list that lands after the page was left is still there next time', async () => {
  let resolveFetch: (activities: FriendActivity[]) => void = () => undefined;
  jest.mocked(fetchFriendActivities).mockReturnValueOnce(
    new Promise((resolve) => {
      resolveFetch = resolve;
    }),
  );
  render(<NewFriendsScreen />).unmount();
  await act(async () => {
    resolveFetch([activity('阿青')]);
    await Promise.resolve();
  });

  jest.mocked(fetchFriendActivities).mockReturnValue(new Promise(() => {}));
  render(<NewFriendsScreen />);
  expect(screen.getByText('阿青')).toBeTruthy();
});
