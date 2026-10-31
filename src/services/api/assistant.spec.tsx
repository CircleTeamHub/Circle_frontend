import { fetchAssistantBootstrap, updateAssistantPreferences } from './assistant';
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

it('defaults onboarding fields for subscriptions created before the assistant wizard', async () => {
  mockedApiClient.mockResolvedValueOnce({
    assistant: {
      key: 'windnote-assistant',
      displayName: '风信助手',
      avatarKey: 'windnote-mascot-v1',
      conversationId: 'assistant-conversation',
    },
    conversation,
    unreadCount: 0,
    subscriptions: [
      {
        id: 'subscription-1',
        circleId: 'circle-1',
        circleName: '北京生活圈',
        circleCities: ['北京'],
        cities: ['北京'],
        followsCircleCities: false,
        sourceTypes: ['PLAZA_POST'],
        enabled: true,
        pushEnabled: true,
        createdAt: '2026-10-30T10:00:00.000Z',
        updatedAt: '2026-10-30T10:00:00.000Z',
      },
    ],
    contextCircle: null,
    capabilities: {
      infoSubscriptions: true,
      noteStatusAlerts: true,
      dailyDigest: false,
    },
  });

  const result = await fetchAssistantBootstrap();

  expect(result.subscriptions[0]).toEqual(
    expect.objectContaining({ keywords: [] }),
  );
  expect(result.subscriptions[0]).not.toHaveProperty('noteStatusAlerts');
});

const bootstrapWith = (extra: Record<string, unknown>) => ({
  assistant: {
    key: 'windnote-assistant',
    displayName: '风信助手',
    avatarKey: 'windnote-mascot-v1',
    conversationId: 'assistant-conversation',
  },
  conversation,
  unreadCount: 0,
  ...bootstrapExtras,
  ...extra,
});

it('reads the note alert switch from the user-level preferences', async () => {
  mockedApiClient.mockResolvedValueOnce(
    bootstrapWith({ preferences: { noteStatusAlerts: false } }),
  );

  const result = await fetchAssistantBootstrap();

  expect(result.preferences).toEqual({ noteStatusAlerts: false });
});

it('treats a backend without preferences as note alerts on', async () => {
  mockedApiClient.mockResolvedValueOnce(bootstrapWith({}));

  const result = await fetchAssistantBootstrap();

  expect(result.preferences).toEqual({ noteStatusAlerts: true });
});

it('rejects malformed preferences', async () => {
  mockedApiClient.mockResolvedValueOnce(
    bootstrapWith({ preferences: { noteStatusAlerts: 'yes' } }),
  );

  await expect(fetchAssistantBootstrap()).rejects.toThrow('助手初始化数据格式异常');
});

it('saves the note alert switch per user', async () => {
  mockedApiClient.mockResolvedValueOnce({ noteStatusAlerts: false });

  await updateAssistantPreferences({ noteStatusAlerts: false });

  expect(mockedApiClient).toHaveBeenCalledWith('/assistant/preferences', {
    method: 'PATCH',
    body: { noteStatusAlerts: false },
  });
});
