import { fetchAssistantBootstrap } from './assistant';
import { apiClient } from '@/services/api/client';

jest.mock('./client', () => ({
  apiClient: jest.fn(),
}));

const mockedApiClient = jest.mocked(apiClient);

const conversation = {
  id: 'assistant-conversation',
  type: 'SUPPORT',
  peer: null,
  circleId: null,
  circle: null,
  name: '风信助手',
  ownerId: null,
  tempChat: null,
  lastMessage: null,
  unreadCount: 0,
  pinned: true,
  muted: false,
};

const bootstrapExtras = {
  subscriptions: [],
  contextCircle: null,
  capabilities: {
    infoSubscriptions: true,
    noteStatusAlerts: true,
    dailyDigest: false,
  },
};

beforeEach(() => {
  mockedApiClient.mockReset();
});

it('validates the support conversation returned by bootstrap', async () => {
  mockedApiClient.mockResolvedValueOnce({
    assistant: {
      key: 'windnote-assistant',
      displayName: '风信助手',
      avatarKey: 'windnote-mascot-v1',
      conversationId: 'assistant-conversation',
    },
    conversation,
    unreadCount: 0,
    ...bootstrapExtras,
  });

  const result = await fetchAssistantBootstrap();

  expect(mockedApiClient).toHaveBeenCalledWith('/assistant/bootstrap');
  expect(result.conversation.id).toBe('assistant-conversation');
});

it('rejects a bootstrap response for a non-support conversation', async () => {
  mockedApiClient.mockResolvedValueOnce({
    assistant: {
      key: 'windnote-assistant',
      displayName: '风信助手',
      avatarKey: 'windnote-mascot-v1',
      conversationId: 'conversation-1',
    },
    conversation: { ...conversation, id: 'conversation-1', type: 'DIRECT' },
    unreadCount: 0,
    ...bootstrapExtras,
  });

  await expect(fetchAssistantBootstrap()).rejects.toThrow('助手初始化数据格式异常');
});
