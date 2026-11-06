import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { CHAT_TARGET_MAX_SELECTION, ChatTargetPicker } from './ChatTargetPicker';
import { useRecentForwardTargetsStore } from './use-recent-forward-targets-store';
import type { ChatConversationDto } from '@/chat-core/protocol';
import { fetchFriends } from '@/services/api/friends';

let mockConversations: ChatConversationDto[] = [];

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/group-chat-avatar', () => ({ GroupChatAvatar: () => null }));
jest.mock('@/components/ui/keyboard-dismiss', () => ({ keyboardDismissOnDragProps: {} }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/storage', () => ({
  mmkvJsonStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
}));
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (state: { user: { id: string } }) => unknown) => selector({ user: { id: 'me' } }),
}));
jest.mock('@/services/api/friends', () => ({ fetchFriends: jest.fn() }));
jest.mock('@/chat-core/api', () => ({ loadChatConversations: jest.fn(() => Promise.resolve()) }));
jest.mock('@/chat-core/conversation-selectors', () => ({
  selectConversations: (state: { conversations: unknown[] }) => state.conversations,
}));
jest.mock('@/chat-core/store', () => ({
  useChatStore: (selector: (state: unknown) => unknown) =>
    selector({ conversations: mockConversations, conversationsSnapshotLoaded: true }),
}));
jest.mock('@/chat-core/mappers', () => ({
  mapChatConversationToUI: (dto: { name?: string; peer?: { nickname?: string } }) => ({
    name: dto.name ?? dto.peer?.nickname ?? '',
    avatarUrl: undefined,
  }),
}));
jest.mock('@/theme', () => ({
  Radius: { full: 99, lg: 16 },
  Spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  Typography: { h3: {}, body: {}, bodyRegular: {}, small: {}, tinyRegular: {} },
  useTheme: () => ({
    colors: {
      background: '#fff', surface: '#fff', surfaceBorder: '#ddd', text: '#111', textSecondary: '#666',
      primary: '#70f', white: '#fff', inputBg: '#eee', error: '#f00',
    },
  }),
}));

const conversation = (overrides: Partial<ChatConversationDto>): ChatConversationDto => ({
  id: 'id', type: 'DIRECT', peer: null, circleId: null, circle: null, name: null, avatarUrl: null,
  lastMessage: null, unreadCount: 0, pinned: false, muted: false, lastMessageAt: null,
  ...overrides,
} as ChatConversationDto);

const direct = conversation({ id: 'dm-1', type: 'DIRECT', peer: { id: 'u1', nickname: '小王' } as ChatConversationDto['peer'] });
const group = conversation({ id: 'g-1', type: 'GROUP', name: '周末爬山' });
const assistant = conversation({ id: 'ai', type: 'SUPPORT', name: 'AI小助手' });

beforeEach(() => {
  jest.clearAllMocks();
  mockConversations = [direct, group, assistant];
  useRecentForwardTargetsStore.setState({ byUser: {} });
  jest.mocked(fetchFriends).mockResolvedValue([
    { id: 'u1', accountId: 'a1', nickname: '小王', avatarUrl: null, avatarFrameAppearance: null, friendsSince: '', remark: null },
    { id: 'u3', accountId: 'a3', nickname: '老李', avatarUrl: null, avatarFrameAppearance: null, friendsSince: '', remark: '李哥' },
  ]);
});

function renderPicker() {
  const onConfirm = jest.fn();
  render(<ChatTargetPicker onClose={jest.fn()} onConfirm={onConfirm} />);
  return onConfirm;
}

test('recent chats list private and group chats but not the assistant', () => {
  renderPicker();
  expect(screen.getByText('小王')).toBeTruthy();
  expect(screen.getByText('周末爬山')).toBeTruthy();
  expect(screen.queryByText('AI小助手')).toBeNull();
});

test('tapping a row in single mode confirms that one chat', () => {
  const onConfirm = renderPicker();
  fireEvent.press(screen.getByText('周末爬山'));
  expect(onConfirm).toHaveBeenCalledWith([expect.objectContaining({ conversationId: 'g-1', kind: 'group' })]);
});

test('the groups tab only lists groups', () => {
  renderPicker();
  fireEvent.press(screen.getByText('chat.targetPicker.groups'));
  expect(screen.getByText('周末爬山')).toBeTruthy();
  expect(screen.queryByText('小王')).toBeNull();
});

test('contacts load on demand and reuse an existing private chat', async () => {
  const onConfirm = renderPicker();
  expect(fetchFriends).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('chat.targetPicker.contacts'));
  await act(async () => { await Promise.resolve(); });
  fireEvent.press(screen.getByText('小王'));
  expect(onConfirm).toHaveBeenLastCalledWith([expect.objectContaining({ conversationId: 'dm-1', userId: 'u1' })]);
  fireEvent.press(screen.getByText('李哥'));
  expect(onConfirm).toHaveBeenLastCalledWith([expect.objectContaining({ conversationId: null, userId: 'u3', key: 'user:u3' })]);
});

test('search spans every source and shows the same person once', async () => {
  renderPicker();
  fireEvent.press(screen.getByText('chat.targetPicker.contacts'));
  await act(async () => { await Promise.resolve(); });
  fireEvent.changeText(screen.getByPlaceholderText('chat.targetPicker.searchPlaceholder'), '小王');
  expect(screen.getAllByText('小王')).toHaveLength(1);
  fireEvent.changeText(screen.getByPlaceholderText('chat.targetPicker.searchPlaceholder'), '不存在');
  expect(screen.getByText('chat.targetPicker.noMatch')).toBeTruthy();
});

test('multi-select collects several chats and sends them together', () => {
  const onConfirm = renderPicker();
  fireEvent.press(screen.getByText('chat.targetPicker.multi'));
  fireEvent.press(screen.getByText('小王'));
  fireEvent.press(screen.getByText('周末爬山'));
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('chat.targetPicker.sendSelected'));
  expect(onConfirm).toHaveBeenCalledWith([
    expect.objectContaining({ conversationId: 'dm-1' }),
    expect.objectContaining({ conversationId: 'g-1' }),
  ]);
});

test('multi-select stops at the limit and says so', () => {
  mockConversations = Array.from({ length: CHAT_TARGET_MAX_SELECTION + 1 }, (_, index) =>
    conversation({ id: `g-${index}`, type: 'GROUP', name: `群${index}` }));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    renderPicker();
    fireEvent.press(screen.getByText('chat.targetPicker.multi'));
    for (let index = 0; index <= CHAT_TARGET_MAX_SELECTION; index += 1) {
      fireEvent.press(screen.getByText(`群${index}`));
    }
    expect(alert).toHaveBeenCalledTimes(1);
  } finally { alert.mockRestore(); }
});

test('recent forwards show live chats, and can be removed one by one or cleared', () => {
  useRecentForwardTargetsStore.setState({
    byUser: {
      me: [
        { key: 'g-1', conversationId: 'g-1', userId: null, name: '旧名字', kind: 'group' },
        { key: 'left', conversationId: 'left', userId: null, name: '已退出的群', kind: 'group' },
        { key: 'dm-1', conversationId: 'dm-1', userId: 'u1', name: '小王', kind: 'direct' },
      ],
    },
  });
  renderPicker();
  expect(screen.getByText('chat.targetPicker.recentForwards')).toBeTruthy();
  // 名字按当前会话列表刷新,已经不在会话列表里的不显示。
  expect(screen.getAllByText('周末爬山')).toHaveLength(2);
  expect(screen.queryByText('旧名字')).toBeNull();
  expect(screen.queryByText('已退出的群')).toBeNull();
  fireEvent.press(screen.getAllByLabelText('chat.targetPicker.removeRecent')[0]);
  expect(useRecentForwardTargetsStore.getState().byUser.me.map((target) => target.key)).toEqual(['left', 'dm-1']);
  fireEvent.press(screen.getByText('chat.targetPicker.clearRecent'));
  expect(useRecentForwardTargetsStore.getState().byUser.me).toEqual([]);
  expect(screen.queryByText('chat.targetPicker.recentForwards')).toBeNull();
});
