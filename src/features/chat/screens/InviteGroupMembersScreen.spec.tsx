import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import InviteGroupMembersScreen from './InviteGroupMembersScreen';
import { fetchChatMembers, inviteGroupChatMembers } from '@/chat-core/api';
import { fetchFriends } from '@/services/api/friends';
import { topNotice } from '@/components/app/top-notice-store';

const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ conversationID: 'group-1', title: '同事群' }),
  useRouter: () => ({ back: mockBack }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && 'error' in opts ? `${key}:${String(opts.error)}` : key,
  }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/theme', () => ({
  Radius: { md: 8, lg: 12, full: 999 },
  Spacing: { xs: 2, sm: 4, md: 8, lg: 16, xl: 24, xxl: 32 },
  Typography: { body: {}, bodyRegular: {}, caption: {} },
  useTheme: () => ({
    colors: {
      background: '#fff',
      surface: '#fff',
      surfaceBorder: '#ddd',
      text: '#111',
      textSecondary: '#666',
      primary: '#00f',
      white: '#fff',
    },
  }),
}));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/keyboard-dismiss', () => ({
  keyboardDismissOnDragProps: {},
}));
jest.mock('@/observability/report-failure', () => ({
  reportHandledFailure: jest.fn(),
}));
jest.mock('@/components/app/top-notice-store', () => ({
  topNotice: { success: jest.fn(), error: jest.fn() },
}));
jest.mock('@/chat-core/api', () => ({
  fetchChatMembers: jest.fn(),
  inviteGroupChatMembers: jest.fn(),
}));
jest.mock('@/services/api/friends', () => ({ fetchFriends: jest.fn() }));
jest.mock('@/chat-core/store', () => ({
  useChatStore: { getState: () => ({ upsertConversation: jest.fn() }) },
}));
// 真实的 getApiErrorMessage 只会把认识的错误码翻成本地化文案,其余回落 fallback;
// 这里用同样语义的替身，断言「错误确实过了这个漏斗」而不是被原样直出。
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (error: unknown, fallback: string) => {
    const code = (error as { errorCode?: string } | null)?.errorCode;
    return code ? `serverErrors.${code}` : fallback;
  },
}));

const friend = (id: string, nickname: string) => ({
  id,
  accountId: id.toUpperCase(),
  nickname,
  remark: null,
  avatarUrl: null,
});

// jest-expo 冷启动下首帧很慢,findBy* 的 1s 默认超时会假红。
jest.setTimeout(30_000);
const SETTLE = { timeout: 10_000 };

/** 渲染并等加载那一串 promise 落地(两次请求各自 settle 后才有列表)。 */
async function renderLoaded() {
  render(<InviteGroupMembersScreen />);
  await screen.findByLabelText('messages.inviteGroupMembersSubmit', {}, SETTLE);
}

function apiError(errorCode: string) {
  const error = new Error('403 Forbidden https://api.internal/chat/...');
  error.name = 'ApiError';
  return Object.assign(error, { errorCode, status: 403 });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(fetchFriends).mockResolvedValue([
    friend('u1', '阿宁'),
    friend('u2', '小林'),
  ] as never);
});

test('a forbidden member directory still lists the friends to invite', async () => {
  // 「是否显示群成员」关着时,普通成员拿到 403。整体 Promise.all 会让好友列表
  // 也一起丢掉 —— 入口还在,点进来却是一片空白。
  jest
    .mocked(fetchChatMembers)
    .mockRejectedValue(apiError('CHAT_MEMBER_DIRECTORY_FORBIDDEN'));

  await renderLoaded();

  expect(await screen.findByText('阿宁', {}, SETTLE)).toBeTruthy();
  expect(screen.getByText('小林')).toBeTruthy();
  // 目录失败不是用户要处理的事(邀请本身照走),不打扰他。
  expect(topNotice.error).not.toHaveBeenCalled();
});

test('members already in the group drop out of the candidates when the directory loads', async () => {
  jest
    .mocked(fetchChatMembers)
    .mockResolvedValue([
      { userId: 'u1', nickname: '阿宁', avatarUrl: null, role: 'MEMBER' },
    ] as never);

  await renderLoaded();

  expect(await screen.findByText('小林', {}, SETTLE)).toBeTruthy();
  expect(screen.queryByText('阿宁')).toBeNull();
});

test('a friends-list failure is surfaced through the localized funnel, not swallowed', async () => {
  jest.mocked(fetchChatMembers).mockResolvedValue([] as never);
  jest.mocked(fetchFriends).mockRejectedValue(apiError('CHAT_NOT_MEMBER'));

  await renderLoaded();

  await waitFor(
    () =>
      expect(topNotice.error).toHaveBeenCalledWith(
        'serverErrors.CHAT_NOT_MEMBER',
      ),
    SETTLE,
  );
  expect(jest.mocked(topNotice.error).mock.calls[0][0]).not.toContain(
    'api.internal',
  );
});

test('an invite rejected by the backend shows the localized reason, never the raw error', async () => {
  // 目录拿不到时已在群里的好友仍会出现在候选里;真被服务端拒时,
  // 用户看到的必须是错误码对应的文案。
  jest
    .mocked(fetchChatMembers)
    .mockRejectedValue(apiError('CHAT_MEMBER_DIRECTORY_FORBIDDEN'));
  jest
    .mocked(inviteGroupChatMembers)
    .mockRejectedValue(apiError('CHAT_GROUP_FRIENDS_ONLY'));

  await renderLoaded();
  fireEvent.press(await screen.findByLabelText('阿宁', {}, SETTLE));
  fireEvent.press(screen.getByLabelText('messages.inviteGroupMembersSubmit'));

  await waitFor(
    () =>
      expect(Alert.alert).toHaveBeenCalledWith(
        'messages.inviteGroupMembersFailed:serverErrors.CHAT_GROUP_FRIENDS_ONLY',
      ),
    SETTLE,
  );
  expect(mockBack).not.toHaveBeenCalled();
});
