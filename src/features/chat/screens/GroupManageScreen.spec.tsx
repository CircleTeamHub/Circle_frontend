import React from 'react';
import { ActivityIndicator } from 'react-native';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import GroupManageScreen from './GroupManageScreen';
import { fetchChatMembers, refreshConversationOrList } from '@/chat-core/api';
import { fetchCircleDetail } from '@/services/api/circles';
import {
  readGroupInfoCache,
  writeGroupInfoCache,
} from '@/features/chat/group-info-cache';

jest.setTimeout(30_000);
const SETTLE = { timeout: 10_000 };

const mockAuth = { sessionEpoch: 0 };
const mockParams: { conversationID?: string; groupID?: string } = {};
const mockChatState: {
  currentUserId: string;
  conversations: Record<string, unknown>[];
} = { currentUserId: 'me', conversations: [] };
let mockAdminParams: {
  onMemberUpdated: (userId: string, patch: Record<string, unknown>) => void;
  onMemberRemoved: (userId: string) => void;
} | null = null;

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (callback: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(callback, [callback]);
  },
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
  Radius: { lg: 12, xl: 16, full: 999 },
  Spacing: { xs: 2, sm: 4, md: 8, lg: 16, xl: 24 },
  Typography: { body: {}, bodyRegular: {}, small: {} },
  useTheme: () => ({
    colors: {
      background: '#fff',
      surface: '#fff',
      surfaceBorder: '#ddd',
      text: '#111',
      textSecondary: '#666',
      primary: '#00f',
      error: '#f00',
      iconAccent: '#0af',
      white: '#fff',
    },
  }),
}));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/divider', () => ({ Divider: () => null }));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/components/ui/option-picker-sheet', () => ({ OptionPickerSheet: () => null }));
jest.mock('@/components/ui/themed-switch', () => ({ ThemedSwitch: () => null }));
jest.mock('@/features/chat/components/group-member-picker-sheet', () => ({
  GroupMemberPickerSheet: () => null,
}));
jest.mock('@/chat-core/api', () => ({
  fetchChatMembers: jest.fn(),
  refreshConversationOrList: jest.fn(),
  setGroupChatMuteAll: jest.fn(),
  transferGroupChatOwner: jest.fn(),
  updateGroupChatPolicies: jest.fn(),
}));
jest.mock('@/chat-core/message-mappers', () => ({
  groupPolicyLabel: (key: string) => key,
}));
jest.mock('@/chat-core/silence-durations', () => ({
  SILENCE_DURATION_OPTIONS: [],
  silenceDurationLabel: () => '',
  silenceStatusLabel: () => '',
}));
jest.mock('@/chat-core/store', () => ({
  useChatStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector(mockChatState),
    { getState: () => mockChatState },
  ),
}));
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector(mockAuth),
}));
jest.mock('@/features/chat/hooks/use-group-admin-actions', () => ({
  isSilencedMember: (member: { silenced?: boolean }) => Boolean(member.silenced),
  useGroupAdminActions: (params: typeof mockAdminParams) => {
    mockAdminParams = params;
    return {
      pendingUserID: null,
      canChangeRole: () => true,
      canSilence: () => true,
      canKick: () => true,
      changeRole: jest.fn(),
      changeRoleBatch: jest.fn(),
      kick: jest.fn(),
      silenceBatch: jest.fn(),
      unsilence: jest.fn(),
    };
  },
}));
jest.mock('@/services/api/circles', () => ({ fetchCircleDetail: jest.fn() }));
jest.mock('@/features/chat/utils/group-reload-key', () => ({
  groupConversationReloadKey: () => '',
  groupOrCircleMutatedSince: () => false,
}));
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (_: unknown, fallback: string) => fallback,
}));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/features/user/utils/routes', () => ({
  getUserProfileScopeFromSegments: () => 'messages',
}));
jest.mock('@/features/groups/routes', () => ({ getGroupEntryHref: () => ({}) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const member = (userId: string, nickname: string, role = 'MEMBER') => ({
  userId,
  nickname,
  avatarUrl: null,
  role,
});
const POLICIES = {
  memberCanInvite: true,
  qrJoinEnabled: true,
  membersCanViewRoster: true,
  membersCanViewProfiles: true,
  membersCanAddFriends: true,
};
const spinner = () => screen.UNSAFE_queryByType(ActivityIndicator);
const cachedIDs = (key: string) =>
  readGroupInfoCache(mockAuth.sessionEpoch, key)?.members?.map((item) => item.userId);

beforeEach(() => {
  jest.clearAllMocks();
  // 每个用例换一个「账号」:成员缓存按 sessionEpoch 整份作废,用例之间互不串。
  mockAuth.sessionEpoch += 1;
  mockAdminParams = null;
  delete mockParams.conversationID;
  delete mockParams.groupID;
  mockChatState.conversations = [];
  jest.mocked(refreshConversationOrList).mockResolvedValue(null as never);
});

describe('standalone group', () => {
  beforeEach(() => {
    mockParams.conversationID = 'conv-1';
    // 独立群聊的本人角色来自成员目录(服务端按 ownerId 派生):我是群主。
    mockChatState.conversations = [
      { id: 'conv-1', ownerId: 'me', muteAll: false, policies: POLICIES },
    ];
  });

  test('the first visit spins until the roster arrives, then remembers it', async () => {
    const directory = deferred<unknown>();
    jest.mocked(fetchChatMembers).mockReturnValueOnce(directory.promise as never);

    render(<GroupManageScreen />);
    expect(spinner()).not.toBeNull();

    await act(async () => {
      directory.resolve([member('me', '我', 'OWNER'), member('u2', '张三', 'ADMIN')]);
    });
    expect(await screen.findByText('张三', {}, SETTLE)).toBeTruthy();
    expect(cachedIDs('standalone:conv-1')).toEqual(['me', 'u2']);
  });

  test('a cached standalone roster stays hidden until the seat check succeeds', async () => {
    // 群聊信息页拉过的名单(同一个键),这里直接用。
    writeGroupInfoCache(mockAuth.sessionEpoch, 'standalone:conv-1', {
      members: [member('me', '我', 'OWNER'), member('u2', '张三', 'ADMIN')] as never,
    });
    const directory = deferred<unknown>();
    jest.mocked(fetchChatMembers).mockReturnValueOnce(directory.promise as never);

    render(<GroupManageScreen />);
    expect(screen.queryByText('张三')).toBeNull();
    expect(spinner()).not.toBeNull();
    expect(fetchChatMembers).toHaveBeenCalledWith('conv-1');

    await act(async () => {
      directory.resolve([member('me', '我', 'OWNER'), member('u3', '李四', 'ADMIN')]);
    });
    expect(await screen.findByText('李四', {}, SETTLE)).toBeTruthy();
    expect(screen.queryByText('张三')).toBeNull();
    expect(spinner()).toBeNull();
    expect(cachedIDs('standalone:conv-1')).toEqual(['me', 'u3']);
  });

  test('changing or removing a member here drops the cached roster', async () => {
    jest
      .mocked(fetchChatMembers)
      .mockResolvedValue([member('me', '我', 'OWNER'), member('u2', '张三', 'ADMIN')] as never);
    render(<GroupManageScreen />);
    await screen.findByText('张三', {}, SETTLE);
    expect(cachedIDs('standalone:conv-1')).toEqual(['me', 'u2']);

    act(() => mockAdminParams?.onMemberUpdated('u2', { role: 'MEMBER' }));
    expect(readGroupInfoCache(mockAuth.sessionEpoch, 'standalone:conv-1')).toBeUndefined();

    writeGroupInfoCache(mockAuth.sessionEpoch, 'standalone:conv-1', {
      members: [member('me', '我', 'OWNER'), member('u2', '张三')] as never,
    });
    act(() => mockAdminParams?.onMemberRemoved('u2'));
    expect(readGroupInfoCache(mockAuth.sessionEpoch, 'standalone:conv-1')).toBeUndefined();
  });

  test('a failed refresh drops the cached roster as well', async () => {
    writeGroupInfoCache(mockAuth.sessionEpoch, 'standalone:conv-1', {
      members: [member('me', '我', 'OWNER'), member('u2', '张三', 'ADMIN')] as never,
    });
    jest.mocked(fetchChatMembers).mockRejectedValueOnce(new Error('403'));

    render(<GroupManageScreen />);
    expect(
      await screen.findByText('chat.groupManagement.loadFailed', {}, SETTLE),
    ).toBeTruthy();
    expect(readGroupInfoCache(mockAuth.sessionEpoch, 'standalone:conv-1')).toBeUndefined();
  });
});

describe('circle group', () => {
  beforeEach(() => {
    mockParams.conversationID = 'conv-c';
    mockParams.groupID = 'circle-1';
    writeGroupInfoCache(mockAuth.sessionEpoch, 'circle:circle-1', {
      members: [member('me', '我', 'OWNER'), member('u2', '张三', 'ADMIN')] as never,
    });
  });

  test('keeps cached circle management data hidden until the live role answers', async () => {
    mockChatState.conversations = [
      { id: 'conv-c', circleId: 'circle-1', myRole: 'OWNER', policies: POLICIES },
    ];
    const detail = deferred<unknown>();
    const directory = deferred<unknown>();
    jest.mocked(fetchCircleDetail).mockReturnValueOnce(detail.promise as never);
    jest.mocked(fetchChatMembers).mockReturnValueOnce(directory.promise as never);

    render(<GroupManageScreen />);
    expect(screen.queryByText('张三')).toBeNull();
    expect(spinner()).not.toBeNull();

    // 活体角色以圈子详情为准:已经被撤成普通成员,管理页随即收起。
    await act(async () => {
      detail.resolve({ myStatus: 'ACTIVE', myRole: 'MEMBER' });
      directory.resolve([member('me', '我'), member('u2', '张三', 'ADMIN')]);
    });
    expect(
      await screen.findByText('chat.groupManagement.restricted', {}, SETTLE),
    ).toBeTruthy();
    expect(screen.queryByText('张三')).toBeNull();
  });

  test('with no role to go on it spins instead of claiming there is no access', () => {
    // 从圈子详情直进:store 里还没有会话 DTO,也就没有 myRole 可借。
    jest.mocked(fetchCircleDetail).mockReturnValueOnce(new Promise(() => {}) as never);
    jest.mocked(fetchChatMembers).mockReturnValueOnce(new Promise(() => {}) as never);

    render(<GroupManageScreen />);
    expect(spinner()).not.toBeNull();
    expect(screen.queryByText('chat.groupManagement.restricted')).toBeNull();
    expect(screen.queryByText('张三')).toBeNull();
  });

  test('a successful refresh writes the roster back for the chat info page', async () => {
    mockChatState.conversations = [
      { id: 'conv-c', circleId: 'circle-1', myRole: 'OWNER', policies: POLICIES },
    ];
    jest
      .mocked(fetchCircleDetail)
      .mockResolvedValueOnce({ myStatus: 'ACTIVE', myRole: 'OWNER' } as never);
    jest
      .mocked(fetchChatMembers)
      .mockResolvedValueOnce([member('me', '我', 'OWNER'), member('u9', '王五', 'ADMIN')] as never);

    render(<GroupManageScreen />);
    expect(await screen.findByText('王五', {}, SETTLE)).toBeTruthy();
    await waitFor(() => expect(cachedIDs('circle:circle-1')).toEqual(['me', 'u9']), SETTLE);
  });
});
