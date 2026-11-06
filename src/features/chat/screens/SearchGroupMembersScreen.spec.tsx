import React from 'react';
import { ActivityIndicator, Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import SearchGroupMembersScreen from './SearchGroupMembersScreen';
import { createCircleChatConversation, fetchChatMembers } from '@/chat-core/api';
import { useGroupMemberViewAccess } from '@/features/chat/hooks/use-group-member-view-access';
import {
  readGroupInfoCache,
  writeGroupInfoCache,
} from '@/features/chat/group-info-cache';

jest.setTimeout(30_000);
const SETTLE = { timeout: 10_000 };

const mockNavigate = jest.fn();
const mockAuth = { sessionEpoch: 0 };
const mockParams: { groupID?: string; conversationID?: string } = {};
const mockChatState: {
  currentUserId: string;
  conversations: Record<string, unknown>[];
} = { currentUserId: 'me', conversations: [] };

jest.mock('expo-router', () => ({
  router: { navigate: (...args: unknown[]) => mockNavigate(...args) },
  useLocalSearchParams: () => mockParams,
  useSegments: () => ['(tabs)', 'messages'],
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  // 群缓存 → group-reload-key → api client 会把 @/i18n 带进来。
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/theme', () => ({
  Radius: { md: 8, lg: 12, full: 999 },
  Spacing: { xs: 2, sm: 4, md: 8, lg: 16, xl: 24, xxl: 32 },
  Typography: { body: {}, bodyRegular: {} },
  useTheme: () => ({
    colors: {
      background: '#fff',
      surface: '#fff',
      text: '#111',
      textSecondary: '#666',
      primary: '#00f',
    },
  }),
}));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/keyboard-dismiss', () => ({
  keyboardDismissOnDragProps: {},
}));
jest.mock('@/chat-core/api', () => ({
  createCircleChatConversation: jest.fn(),
  fetchChatMembers: jest.fn(),
}));
jest.mock('@/chat-core/store', () => ({
  useChatStore: (selector: (state: unknown) => unknown) => selector(mockChatState),
}));
jest.mock('@/stores/authStore', () => ({
  // 群缓存自己读 getState() 核对 sessionEpoch。
  useAuthStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector(mockAuth),
    { getState: () => mockAuth },
  ),
}));
// 群缓存在原生端只在加密库就绪后才工作;给它一个内存 MMKV。
jest.mock('@/storage/encrypted-init', () => {
  const instance = jest.requireActual('react-native-mmkv').createMMKV({ id: 'spec' });
  return { getEncryptedInstance: () => instance, initEncryptedStorage: async () => instance };
});
jest.mock('@/features/chat/hooks/use-group-member-view-access', () => ({
  useGroupMemberViewAccess: jest.fn(),
}));
jest.mock('@/features/user/utils/routes', () => ({
  getUserProfileScopeFromSegments: () => 'messages',
  getUserProfileHref: (
    scope: string,
    id: string,
    name?: string,
    opts?: Record<string, unknown>,
  ) => ({ pathname: `/${scope}/user/${id}`, params: { name, ...opts } }),
}));

const CLOSED_POLICIES = {
  memberCanInvite: true,
  qrJoinEnabled: true,
  membersCanViewRoster: true,
  membersCanViewProfiles: false,
  membersCanAddFriends: true,
};

const member = (userId: string, nickname: string) => ({
  userId,
  nickname,
  avatarUrl: null,
  role: 'MEMBER' as const,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const spinner = () => screen.UNSAFE_queryByType(ActivityIndicator);

beforeEach(() => {
  jest.clearAllMocks();
  // 每个用例换一个「账号」:成员缓存按 sessionEpoch 整份作废,用例之间互不串。
  mockAuth.sessionEpoch += 1;
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  delete mockParams.groupID;
  delete mockParams.conversationID;
  mockChatState.conversations = [];
  jest.mocked(useGroupMemberViewAccess).mockReturnValue({
    canViewMembers: true,
    selfMember: null,
    resolved: true,
    verificationFailed: false,
    revalidate: jest.fn().mockResolvedValue(true),
  });
  jest
    .mocked(fetchChatMembers)
    .mockResolvedValue([member('me', '我'), member('u2', '张三')] as never);
});

test('a standalone group blocks an ordinary member from opening another profile', async () => {
  mockParams.conversationID = 'conv-1';
  mockChatState.conversations = [
    { id: 'conv-1', myRole: 'MEMBER', policies: CLOSED_POLICIES },
  ];

  render(<SearchGroupMembersScreen />);
  fireEvent.press(await screen.findByText('张三', {}, SETTLE));

  expect(Alert.alert).toHaveBeenCalledWith('chat.profilesRestrictedByGroup');
  expect(mockNavigate).not.toHaveBeenCalled();
});

test('a circle group gets the same gate — this screen was the last way around it', async () => {
  // 这个策略只在客户端拦。本页对圈子群直接 `return true` 时,
  // 「群信息 → 群成员 → 点人」整条路就绕开了 ChatInfo/ChatDetail 的那道闸。
  mockParams.groupID = 'circle-1';
  jest.mocked(createCircleChatConversation).mockResolvedValue({
    id: 'conv-circle',
    circleId: 'circle-1',
    myRole: 'MEMBER',
    policies: CLOSED_POLICIES,
  } as never);

  render(<SearchGroupMembersScreen />);
  fireEvent.press(await screen.findByText('张三', {}, SETTLE));

  expect(Alert.alert).toHaveBeenCalledWith('chat.profilesRestrictedByGroup');
  expect(mockNavigate).not.toHaveBeenCalled();
});

test('managers are exempt and the profile carries the group context', async () => {
  mockParams.conversationID = 'conv-1';
  mockChatState.conversations = [
    { id: 'conv-1', myRole: 'ADMIN', policies: CLOSED_POLICIES },
  ];

  render(<SearchGroupMembersScreen />);
  fireEvent.press(await screen.findByText('张三', {}, SETTLE));

  await waitFor(
    () =>
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.objectContaining({
          pathname: '/messages/user/u2',
          // 资料页据此按本群的「成员可添加好友」决定要不要放加好友入口。
          params: expect.objectContaining({ viaConversationID: 'conv-1' }),
        }),
      ),
    SETTLE,
  );
  expect(Alert.alert).not.toHaveBeenCalled();
});

test('looking at my own profile is always allowed', async () => {
  mockParams.conversationID = 'conv-1';
  mockChatState.conversations = [
    { id: 'conv-1', myRole: 'MEMBER', policies: CLOSED_POLICIES },
  ];

  render(<SearchGroupMembersScreen />);
  fireEvent.press(await screen.findByText('我', {}, SETTLE));

  await waitFor(() => expect(mockNavigate).toHaveBeenCalled(), SETTLE);
  expect(Alert.alert).not.toHaveBeenCalled();
});

describe('a group seen before', () => {
  const HIDDEN_ROSTER = { ...CLOSED_POLICIES, membersCanViewRoster: false };
  const cached = [member('me', '我'), member('u2', '张三')];

  test('keeps a standalone cached roster hidden until the seat check succeeds', async () => {
    mockParams.conversationID = 'conv-1';
    mockChatState.conversations = [
      { id: 'conv-1', myRole: 'MEMBER', policies: CLOSED_POLICIES },
    ];
    // 与群聊信息页同一个键:那边拉过的名单,这里直接用。
    writeGroupInfoCache(mockAuth.sessionEpoch, 'standalone:conv-1', {
      members: cached as never,
    });
    const refresh = deferred<unknown>();
    jest.mocked(fetchChatMembers).mockReturnValueOnce(refresh.promise as never);

    render(<SearchGroupMembersScreen />);
    expect(screen.queryByText('张三')).toBeNull();
    expect(spinner()).not.toBeNull();

    await act(async () => {
      refresh.resolve([member('me', '我'), member('u3', '李四')]);
    });
    expect(await screen.findByText('李四', {}, SETTLE)).toBeTruthy();
    expect(screen.queryByText('张三')).toBeNull();
    expect(spinner()).toBeNull();
    expect(
      readGroupInfoCache(mockAuth.sessionEpoch, 'standalone:conv-1')?.members?.map(
        (item) => item.userId,
      ),
    ).toEqual(['me', 'u3']);
  });

  test('keeps a temp-room cached roster hidden until the seat check succeeds', () => {
    mockParams.conversationID = 'tmp-1';
    mockChatState.conversations = [{ id: 'tmp-1', type: 'TEMP' }];
    writeGroupInfoCache(mockAuth.sessionEpoch, 'temp:tmp-1', { members: cached as never });
    jest.mocked(fetchChatMembers).mockReturnValueOnce(new Promise(() => {}) as never);

    render(<SearchGroupMembersScreen />);
    expect(screen.queryByText('张三')).toBeNull();
    expect(spinner()).not.toBeNull();
  });

  test('keeps a circle manager cache hidden until the live role is back', () => {
    mockParams.groupID = 'circle-1';
    mockChatState.conversations = [
      { id: 'conv-circle', circleId: 'circle-1', myRole: 'ADMIN', policies: HIDDEN_ROSTER },
    ];
    jest.mocked(useGroupMemberViewAccess).mockReturnValue({
      canViewMembers: false,
      selfMember: null,
      resolved: false,
      verificationFailed: false,
      revalidate: jest.fn().mockResolvedValue(true),
    });
    writeGroupInfoCache(mockAuth.sessionEpoch, 'circle:circle-1', { members: cached as never });
    jest.mocked(createCircleChatConversation).mockReturnValue(new Promise(() => {}) as never);

    render(<SearchGroupMembersScreen />);
    expect(screen.queryByText('张三')).toBeNull();
    expect(spinner()).not.toBeNull();
  });

  test('an ordinary member of a hidden roster waits for the live role instead of seeing the cache', () => {
    mockParams.groupID = 'circle-1';
    mockChatState.conversations = [
      { id: 'conv-circle', circleId: 'circle-1', myRole: 'MEMBER', policies: HIDDEN_ROSTER },
    ];
    jest.mocked(useGroupMemberViewAccess).mockReturnValue({
      canViewMembers: false,
      selfMember: null,
      resolved: false,
      verificationFailed: false,
      revalidate: jest.fn().mockResolvedValue(false),
    });
    writeGroupInfoCache(mockAuth.sessionEpoch, 'circle:circle-1', { members: cached as never });
    jest.mocked(createCircleChatConversation).mockReturnValue(new Promise(() => {}) as never);

    render(<SearchGroupMembersScreen />);
    expect(screen.queryByText('张三')).toBeNull();
    expect(spinner()).not.toBeNull();
  });

  test('losing access drops the cached roster so the next visit cannot show it', async () => {
    mockParams.groupID = 'circle-1';
    mockChatState.conversations = [
      { id: 'conv-circle', circleId: 'circle-1', myRole: 'MEMBER', policies: HIDDEN_ROSTER },
    ];
    jest.mocked(useGroupMemberViewAccess).mockReturnValue({
      canViewMembers: false,
      selfMember: { userID: 'me', role: 'MEMBER' },
      resolved: true,
      verificationFailed: false,
      revalidate: jest.fn().mockResolvedValue(false),
    });
    writeGroupInfoCache(mockAuth.sessionEpoch, 'circle:circle-1', { members: cached as never });
    jest.mocked(createCircleChatConversation).mockResolvedValue({
      id: 'conv-circle',
      circleId: 'circle-1',
      myRole: 'MEMBER',
      policies: HIDDEN_ROSTER,
    } as never);

    render(<SearchGroupMembersScreen />);
    expect(await screen.findByText('chat.groupMembersRestricted', {}, SETTLE)).toBeTruthy();
    expect(screen.queryByText('张三')).toBeNull();
    await waitFor(
      () => expect(readGroupInfoCache(mockAuth.sessionEpoch, 'circle:circle-1')).toBeUndefined(),
      SETTLE,
    );
    expect(fetchChatMembers).not.toHaveBeenCalled();
  });
});


test('live circle revocation hides an already loaded roster before the replacement request settles', async () => {
  mockParams.groupID = 'circle-1';
  const conversation = {
    id: 'conv-circle', circleId: 'circle-1', myRole: 'ADMIN',
    policies: { ...CLOSED_POLICIES, membersCanViewRoster: false },
  };
  mockChatState.conversations = [conversation];
  jest.mocked(createCircleChatConversation).mockResolvedValue(conversation as never);
  const view = render(<SearchGroupMembersScreen />);
  expect(await screen.findByText('张三', {}, SETTLE)).toBeTruthy();

  const replacement = deferred<unknown>();
  jest.mocked(createCircleChatConversation).mockReturnValueOnce(replacement.promise as never);
  jest.mocked(useGroupMemberViewAccess).mockReturnValue({
    canViewMembers: false,
    selfMember: { userID: 'me', role: 'MEMBER' },
    resolved: true,
    verificationFailed: false,
    revalidate: jest.fn().mockResolvedValue(false),
  });
  view.rerender(<SearchGroupMembersScreen />);

  expect(screen.queryByText('张三')).toBeNull();
  expect(screen.getByText('chat.groupMembersRestricted')).toBeTruthy();
});
