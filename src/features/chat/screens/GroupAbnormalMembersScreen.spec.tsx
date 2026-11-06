import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import GroupAbnormalMembersScreen, {
  ABNORMAL_BATCH_REMOVE_LIMIT,
} from './GroupAbnormalMembersScreen';
import { fetchChatAbnormalMembers, fetchChatMembers } from '@/chat-core/api';
import { fetchCircleDetail } from '@/services/api/circles';
import { evictGroupInfoCache } from '@/features/chat/group-info-cache';

jest.setTimeout(30_000);
const SETTLE = { timeout: 10_000 };

const mockParams: { conversationID?: string; groupID?: string } = {};
const mockKickBatch = jest.fn();
let mockAdminParams: { onMemberRemoved: (userId: string) => void; selfRole: unknown } | null = null;

jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'n' in options ? `${key}:${String(options.n)}` : key,
  }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/theme', () => ({
  Radius: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, full: 999 },
  Spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  Typography: { body: {}, bodyRegular: {}, small: {}, caption: {}, tiny: {} },
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000' }) }),
}));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/divider', () => ({ Divider: () => null }));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/chat-core/api', () => ({
  fetchChatMembers: jest.fn(),
  fetchChatAbnormalMembers: jest.fn(),
}));
jest.mock('@/chat-core/store', () => ({
  useChatStore: (selector: (state: unknown) => unknown) =>
    selector({ currentUserId: 'me', conversations: [{ id: 'conv-1', ownerId: 'me' }] }),
}));
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ user: { id: 'me' }, sessionEpoch: 3 }),
}));
jest.mock('@/features/chat/group-info-cache', () => ({ evictGroupInfoCache: jest.fn() }));
jest.mock('@/features/chat/hooks/use-group-admin-actions', () => ({
  useGroupAdminActions: (params: typeof mockAdminParams) => {
    mockAdminParams = params;
    return { pendingUserID: null, kickBatch: mockKickBatch };
  },
}));
jest.mock('@/services/api/circles', () => ({ fetchCircleDetail: jest.fn() }));
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (_: unknown, fallback: string) => fallback,
}));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));

const member = (userId: string, nickname: string, role = 'MEMBER') => ({
  userId,
  nickname,
  avatarUrl: null,
  role,
});
const inactive = (userId: string, days: number) => ({
  userId,
  reasons: ['INACTIVE'],
  lastActiveAt: new Date(Date.now() - days * 86_400_000).toISOString(),
  creditScore: null,
});
const lowCredit = (userId: string, score: number) => ({
  userId,
  reasons: ['LOW_CREDIT'],
  lastActiveAt: null,
  creditScore: score,
});
const page = (members: unknown[]) => ({ inactiveDays: 30, creditThreshold: 60, members });

beforeEach(() => {
  jest.clearAllMocks();
  mockAdminParams = null;
  mockParams.conversationID = 'conv-1';
  delete mockParams.groupID;
  jest.mocked(fetchChatMembers).mockResolvedValue([
    member('me', '我', 'OWNER'),
    member('u1', '张三'),
    member('u2', '李四', 'ADMIN'),
    member('u3', '王五'),
  ] as never);
});

test('joins the server verdicts with the roster and drops members who already left', async () => {
  jest.mocked(fetchChatAbnormalMembers).mockResolvedValue(
    page([inactive('u1', 45), lowCredit('u2', 42), inactive('gone', 90)]) as never,
  );

  render(<GroupAbnormalMembersScreen />);

  expect(await screen.findByText('张三', {}, SETTLE)).toBeTruthy();
  expect(screen.getByText('李四')).toBeTruthy();
  expect(screen.getByText('chat.groupManagement.abnormal.tagInactiveDays:45')).toBeTruthy();
  expect(screen.getByText('chat.groupManagement.abnormal.tagLowCredit')).toBeTruthy();
  expect(screen.queryByTestId('abnormal-member-gone')).toBeNull();
  expect(fetchChatAbnormalMembers).toHaveBeenCalledWith('conv-1', 30);
  // 独立群聊:本人角色来自成员目录,不查圈子详情。
  expect(fetchCircleDetail).not.toHaveBeenCalled();
  expect(mockAdminParams?.selfRole).toBe('OWNER');
});

test('filters by reason and refetches when the inactivity window changes', async () => {
  jest.mocked(fetchChatAbnormalMembers).mockResolvedValue(
    page([inactive('u1', 45), lowCredit('u2', 42)]) as never,
  );
  render(<GroupAbnormalMembersScreen />);
  await screen.findByText('张三', {}, SETTLE);

  fireEvent.press(screen.getByTestId('abnormal-filter-LOW_CREDIT'));
  expect(screen.queryByText('张三')).toBeNull();
  expect(screen.getByText('李四')).toBeTruthy();

  fireEvent.press(screen.getByTestId('abnormal-days-90'));
  await waitFor(() => expect(fetchChatAbnormalMembers).toHaveBeenLastCalledWith('conv-1', 90), SETTLE);
});

test('removes the selected members in one batch and drops them from the list', async () => {
  jest.mocked(fetchChatAbnormalMembers).mockResolvedValue(
    page([inactive('u1', 45), inactive('u3', 60)]) as never,
  );
  render(<GroupAbnormalMembersScreen />);
  await screen.findByText('张三', {}, SETTLE);

  fireEvent.press(screen.getByTestId('abnormal-member-u1'));
  fireEvent.press(screen.getByTestId('abnormal-remove-selected'));
  expect(mockKickBatch).toHaveBeenCalledWith([expect.objectContaining({ userId: 'u1' })]);

  act(() => mockAdminParams?.onMemberRemoved('u1'));
  expect(screen.queryByText('张三')).toBeNull();
  expect(screen.getByText('王五')).toBeTruthy();
  expect(evictGroupInfoCache).toHaveBeenCalledWith(3, 'standalone:conv-1');
});

test('select all stops at the batch limit', async () => {
  const many = Array.from({ length: ABNORMAL_BATCH_REMOVE_LIMIT + 5 }, (_, i) => `x${i}`);
  jest
    .mocked(fetchChatMembers)
    .mockResolvedValue(many.map((id) => member(id, `成员${id}`)) as never);
  jest
    .mocked(fetchChatAbnormalMembers)
    .mockResolvedValue(page(many.map((id) => inactive(id, 40))) as never);
  render(<GroupAbnormalMembersScreen />);
  await screen.findByText('成员x0', {}, SETTLE);

  fireEvent.press(screen.getByTestId('abnormal-select-all'));
  expect(
    screen.getByText(`chat.groupManagement.abnormal.removeSelected:${ABNORMAL_BATCH_REMOVE_LIMIT}`),
  ).toBeTruthy();
});

test('circle groups take the live role from the circle detail', async () => {
  mockParams.groupID = 'circle-1';
  jest.mocked(fetchCircleDetail).mockResolvedValue({ myStatus: 'ACTIVE', myRole: 'ADMIN' } as never);
  jest.mocked(fetchChatAbnormalMembers).mockResolvedValue(page([inactive('u1', 45)]) as never);

  render(<GroupAbnormalMembersScreen />);
  await screen.findByText('张三', {}, SETTLE);

  expect(fetchCircleDetail).toHaveBeenCalledWith('circle-1');
  expect(mockAdminParams?.selfRole).toBe('ADMIN');
});

test('shows a retry when the verdicts cannot be loaded', async () => {
  jest.mocked(fetchChatAbnormalMembers).mockRejectedValueOnce(new Error('403'));
  jest.mocked(fetchChatAbnormalMembers).mockResolvedValueOnce(page([]) as never);

  render(<GroupAbnormalMembersScreen />);
  expect(
    await screen.findByText('chat.groupManagement.abnormal.loadFailed', {}, SETTLE),
  ).toBeTruthy();

  fireEvent.press(screen.getByText('common.retry'));
  expect(await screen.findByText('chat.groupManagement.abnormal.empty', {}, SETTLE)).toBeTruthy();
});
