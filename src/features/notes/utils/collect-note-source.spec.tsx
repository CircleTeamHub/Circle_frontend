import { resolveNoteCollectSource } from './collect-note-source';
import { fetchChatHistoryPage, loadChatConversations } from '@/chat-core/api';

const mockUser = { id: 'me', nickname: 'Me', avatarUrl: null };
let mockAuth = { user: mockUser, sessionEpoch: 1 };
let mockChat: any;
let mockDeleted = false;
jest.mock('@/chat-core/api', () => ({ fetchChatHistoryPage: jest.fn(), loadChatConversations: jest.fn() }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => mockAuth } }));
jest.mock('@/chat-core/store', () => ({ useChatStore: { getState: () => mockChat } }));
jest.mock('@/chat-core/deleted-messages', () => ({ isMessageDeletedLocally: () => mockDeleted }));
jest.mock('@/i18n', () => ({ __esModule: true, default: { t: (key: string) => key, language: 'en' } }));
jest.mock('@/services/api/utils', () => ({ normalizeMediaUrl: (url: string) => url, allowPeerMediaUrl: (url: string) => url }));

const message = (overrides = {}) => ({
  id: 'message', conversationId: 'conversation', height: 50, type: 'note-card',
  content: { noteId: 'note', title: 'Shared note' }, sender: { id: 'peer', nickname: 'Peer' },
  replyToId: null, d: null, createdAt: '2026-11-01T00:00:00Z', ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = { user: mockUser, sessionEpoch: 1 };
  mockDeleted = false;
  mockChat = { currentUserId: 'me', messagesByConversation: { conversation: [message()] },
    conversations: [{ id: 'conversation', type: 'DIRECT', peer: { id: 'peer', nickname: 'Peer' },
      circleId: null, circle: null, lastMessage: null, unreadCount: 0, pinned: false, muted: false,
      burnDurationSec: 0 }] };
});

test('builds source from the exact stored note card', async () => {
  expect(await resolveNoteCollectSource('note', 'conversation', 'message', '50')).toMatchObject({
    conversationID: 'conversation', clientMsgID: 'message', sender: { id: 'peer', name: 'Peer' },
  });
  expect(fetchChatHistoryPage).not.toHaveBeenCalled();
});

test('restores missing conversation and exact source message in parallel instead of adding two network round trips', async () => {
  const conversation = mockChat.conversations[0];
  mockChat.conversations = [];
  mockChat.messagesByConversation = {};
  let finish!: () => void;
  jest.mocked(loadChatConversations).mockReturnValue(new Promise((resolve) => { finish = () => {
    mockChat.conversations = [conversation]; resolve(undefined as never);
  }; }));
  jest.mocked(fetchChatHistoryPage).mockResolvedValue({ messages: [message()], nextBeforeHeight: null } as any);
  const pending = resolveNoteCollectSource('note', 'conversation', 'message', '50');
  try {
    expect(fetchChatHistoryPage).toHaveBeenCalledWith('conversation', { beforeHeight: 51, limit: 1 });
  } finally { finish(); }
  expect(await pending).toMatchObject({ clientMsgID: 'message' });
});

test.each([
  { content: { noteId: 'other' } }, { conversationId: 'other' }, { revokedAt: 'today' },
  { deleted: true }, { burnDurationSec: 60 }, { burnExpiresAt: 'tomorrow' },
])('rejects wrong, revoked, deleted or sender-stamped burn sources: %j', async (overrides) => {
  mockChat.messagesByConversation.conversation = [message(overrides)];
  expect(await resolveNoteCollectSource('note', 'conversation', 'message', '50')).toBeNull();
});

test('receiver burn preference does not restrict a sender-stamped permanent message', async () => {
  mockChat.conversations[0].burnDurationSec = 60;
  mockChat.messagesByConversation.conversation = [message({ burnDurationSec: 0, burnExpiresAt: null })];
  expect(await resolveNoteCollectSource('note', 'conversation', 'message', '50')).not.toBeNull();
});

test('own burn message can be collected', async () => {
  mockChat.messagesByConversation.conversation = [message({ sender: mockUser, burnDurationSec: 60 })];
  expect(await resolveNoteCollectSource('note', 'conversation', 'message', '50')).not.toBeNull();
});

test('keeps the shared note card source snapshot instead of substituting the current peer', async () => {
  mockChat.messagesByConversation.conversation = [message({ content: {
    noteId: 'note', title: 'Shared', personalCardSnapshot: { id: 'original', name: 'Original source' },
  } })];
  expect(await resolveNoteCollectSource('note', 'conversation', 'message', '50')).toMatchObject({
    sender: { id: 'original', name: 'Original source' }, clientMsgID: 'message',
  });
});

test('rejects a local tombstone even if the message remains in the memory window', async () => {
  mockDeleted = true;
  expect(await resolveNoteCollectSource('note', 'conversation', 'message', '50')).toBeNull();
});

test('uses one exact history page without paginating past local tombstones', async () => {
  mockChat.messagesByConversation = {};
  mockDeleted = true;
  jest.mocked(fetchChatHistoryPage).mockResolvedValue({ messages: [message()], nextBeforeHeight: 50 } as any);
  expect(await resolveNoteCollectSource('note', 'conversation', 'message', '50')).toBeNull();
  expect(fetchChatHistoryPage).toHaveBeenCalledTimes(1);
  expect(fetchChatHistoryPage).toHaveBeenCalledWith('conversation', { beforeHeight: 51, limit: 1 });
});

test('does not substitute a neighboring message', async () => {
  mockChat.messagesByConversation = {};
  jest.mocked(fetchChatHistoryPage).mockResolvedValue({ messages: [message({ id: 'neighbor' })], nextBeforeHeight: 49 } as any);
  expect(await resolveNoteCollectSource('note', 'conversation', 'message', '50')).toBeNull();
});

test.each(['', '0', '-1', '1.5', '2147483647', '9007199254740991'])('does not query an invalid history height %s', async (height) => {
  mockChat.messagesByConversation = {};
  expect(await resolveNoteCollectSource('note', 'conversation', 'message', height)).toBeNull();
  expect(fetchChatHistoryPage).not.toHaveBeenCalled();
});

test('aborts when the account changes during history lookup', async () => {
  mockChat.messagesByConversation = {};
  jest.mocked(fetchChatHistoryPage).mockImplementation(async () => {
    mockAuth = { ...mockAuth, sessionEpoch: 2 };
    return { messages: [message()], nextBeforeHeight: null } as any;
  });
  expect(await resolveNoteCollectSource('note', 'conversation', 'message', '50')).toBeNull();
});

test('aborts when the account changes while loading conversations', async () => {
  mockChat.conversations = [];
  jest.mocked(loadChatConversations).mockImplementation(async () => {
    mockAuth = { ...mockAuth, sessionEpoch: 2 };
    return undefined as any;
  });
  expect(await resolveNoteCollectSource('note', 'conversation', 'message', '50')).toBeNull();
  expect(fetchChatHistoryPage).not.toHaveBeenCalled();
});
