import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import SearchGroupMembersScreen from './SearchGroupMembersScreen';
import { createCircleChatConversation, fetchChatMembers } from '@/chat-core/api';
import { useGroupMemberViewAccess } from '@/features/chat/hooks/use-group-member-view-access';

jest.setTimeout(30_000);
const SETTLE = { timeout: 10_000 };

const mockPush = jest.fn();
const mockParams: { groupID?: string; conversationID?: string } = {};
const mockChatState: {
  currentUserId: string;
  conversations: Record<string, unknown>[];
} = { currentUserId: 'me', conversations: [] };

jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useLocalSearchParams: () => mockParams,
  useSegments: () => ['(tabs)', 'messages'],
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  delete mockParams.groupID;
  delete mockParams.conversationID;
  mockChatState.conversations = [];
  jest.mocked(useGroupMemberViewAccess).mockReturnValue({
    canViewMembers: true,
    selfMember: null,
    resolved: true,
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
  expect(mockPush).not.toHaveBeenCalled();
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
  expect(mockPush).not.toHaveBeenCalled();
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
      expect(mockPush).toHaveBeenCalledWith(
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

  await waitFor(() => expect(mockPush).toHaveBeenCalled(), SETTLE);
  expect(Alert.alert).not.toHaveBeenCalled();
});
