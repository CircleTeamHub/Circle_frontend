import { fetchFriends } from '@/services/api/friends';
import { loadChatConversations } from '@/chat-core/api';
import { useChatStore } from '@/chat-core/store';
import {
  getCachedNotePickerGroups,
  loadNotePickerGroups,
  prefetchNoteCardPickerData,
} from './note-card-picker-cache';

jest.mock('@/services/api/friends', () => ({ fetchFriends: jest.fn() }));
jest.mock('@/chat-core/api', () => ({ loadChatConversations: jest.fn() }));
jest.mock('@/chat-core/store', () => ({
  useChatStore: { getState: jest.fn() },
}));
// 只关心「哪些会话进选择器、取哪个 id」，展示名直接用会话上的名字。
jest.mock('@/chat-core/mappers', () => ({
  mapChatConversationToUI: (dto: {
    name?: string | null;
    circle?: { name?: string } | null;
    avatarUrl?: string | null;
  }) => ({ name: dto.circle?.name ?? dto.name ?? '', avatarUrl: dto.avatarUrl ?? undefined }),
}));

const mockGetChatState = jest.mocked(useChatStore.getState);

const circleGroup = {
  id: 'conv-circle',
  type: 'GROUP',
  circleId: 'circle-1',
  circle: { name: '圈子群' },
  myRole: 'OWNER',
  joinedAt: '2026-10-01T00:00:00.000Z',
  lastMessageAt: null,
};
const standaloneGroup = {
  id: 'conv-standalone',
  type: 'GROUP',
  circleId: null,
  circle: null,
  name: '独立群',
  avatarUrl: 'https://cdn.test/g.png',
  myRole: 'OWNER',
  joinedAt: '2026-10-02T00:00:00.000Z',
  lastMessageAt: null,
};
// 只是成员/管理员的群：群名片即绑定，只有群主能绑，不进选择器。
const memberGroup = {
  id: 'conv-member',
  type: 'GROUP',
  circleId: null,
  circle: null,
  name: '我只是成员',
  myRole: 'MEMBER',
  joinedAt: '2026-10-03T00:00:00.000Z',
  lastMessageAt: null,
};
const adminCircleGroup = { ...circleGroup, id: 'conv-admin', circleId: 'circle-2', myRole: 'ADMIN' };
const direct = { id: 'conv-direct', type: 'DIRECT', circleId: null, lastMessageAt: null };
const temp = { id: 'conv-temp', type: 'TEMP', circleId: null, lastMessageAt: null };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetChatState.mockReturnValue({ conversations: [], conversationsSnapshotLoaded: false } as never);
  jest.mocked(fetchFriends).mockResolvedValue([]);
  jest.mocked(loadChatConversations).mockResolvedValue([]);
});

test('lists every group chat I own — circle groups and standalone groups — not just circles', async () => {
  mockGetChatState.mockReturnValue({
    conversations: [direct, circleGroup, temp, memberGroup, standaloneGroup, adminCircleGroup],
    conversationsSnapshotLoaded: true,
  } as never);

  const groups = await loadNotePickerGroups('account-a');

  // 最近加入的在前；圈子群沿用圈子 id，独立群用会话 id。
  expect(groups).toEqual([
    { id: 'conv-standalone', name: '独立群', avatarUrl: 'https://cdn.test/g.png' },
    { id: 'circle-1', name: '圈子群', avatarUrl: undefined },
  ]);
  // 单聊、临时会话不是群聊。
  expect(groups.map((group) => group.id)).not.toContain('conv-direct');
  expect(groups.map((group) => group.id)).not.toContain('conv-temp');
  // 不是群主的群（成员、管理员）不进选择器。
  expect(groups.map((group) => group.id)).not.toContain('conv-member');
  expect(groups.map((group) => group.id)).not.toContain('circle-2');
  // 会话列表已在 store 里，不再打网络。
  expect(loadChatConversations).not.toHaveBeenCalled();
});

test('falls back to the conversation API when the chat store has not loaded yet', async () => {
  jest.mocked(loadChatConversations).mockResolvedValueOnce([standaloneGroup, circleGroup] as never);

  await prefetchNoteCardPickerData('account-b');

  expect(loadChatConversations).toHaveBeenCalledTimes(1);
  expect(getCachedNotePickerGroups('account-b')).toEqual([
    { id: 'conv-standalone', name: '独立群', avatarUrl: 'https://cdn.test/g.png' },
    { id: 'circle-1', name: '圈子群', avatarUrl: undefined },
  ]);
  expect(fetchFriends).toHaveBeenCalledTimes(1);
});

test('a partial store (only a direct chat upserted before bootstrap) is not trusted', async () => {
  // 从资料页「发消息」先 upsert 了一条私聊：数组非空，但还没拿到过全量快照。
  mockGetChatState.mockReturnValue({ conversations: [direct], conversationsSnapshotLoaded: false } as never);
  jest.mocked(loadChatConversations).mockResolvedValueOnce([direct, standaloneGroup] as never);

  const groups = await loadNotePickerGroups('account-c');

  expect(loadChatConversations).toHaveBeenCalledTimes(1);
  expect(groups).toEqual([{ id: 'conv-standalone', name: '独立群', avatarUrl: 'https://cdn.test/g.png' }]);
});

test('a complete snapshot with no owned groups is authoritative and does not refetch', async () => {
  mockGetChatState.mockReturnValue({ conversations: [direct], conversationsSnapshotLoaded: true } as never);

  const groups = await loadNotePickerGroups('account-d');

  expect(groups).toEqual([]);
  expect(loadChatConversations).not.toHaveBeenCalled();
});

test('cached groups follow ownership changes already present in the authoritative chat snapshot', async () => {
  mockGetChatState.mockReturnValue({
    conversations: [circleGroup],
    conversationsSnapshotLoaded: true,
  } as never);
  await loadNotePickerGroups('account-e');

  mockGetChatState.mockReturnValue({
    conversations: [{ ...memberGroup, myRole: 'OWNER', name: '新群主的群' }],
    conversationsSnapshotLoaded: true,
  } as never);

  expect(getCachedNotePickerGroups('account-e')).toEqual([
    { id: 'conv-member', name: '新群主的群', avatarUrl: undefined },
  ]);
});
