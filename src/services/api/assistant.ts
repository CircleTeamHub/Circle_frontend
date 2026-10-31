import { apiClient } from '@/services/api/client';
import { buildQuery } from '@/services/api/utils';
import { isPlainObject } from '@/utils/validate';
import type { ChatConversationDto } from '@/chat-core/protocol';
import type {
  AssistantBootstrapResponse,
  AssistantPreferences,
  AssistantSubscription,
} from '@/features/assistant/types';

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isConversationShape(value: unknown): value is ChatConversationDto {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.type === 'SUPPORT' &&
    (value.name == null || typeof value.name === 'string') &&
    (value.lastMessage == null || isPlainObject(value.lastMessage)) &&
    typeof value.unreadCount === 'number' &&
    Number.isFinite(value.unreadCount) &&
    value.unreadCount >= 0 &&
    typeof value.pinned === 'boolean' &&
    typeof value.muted === 'boolean'
  );
}

function isSubscriptionShape(value: unknown): value is AssistantSubscription {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.circleId === 'string' &&
    typeof value.circleName === 'string' &&
    isStringArray(value.circleCities) &&
    isStringArray(value.cities) &&
    (value.keywords === undefined || isStringArray(value.keywords)) &&
    typeof value.followsCircleCities === 'boolean' &&
    isStringArray(value.sourceTypes) &&
    typeof value.enabled === 'boolean' &&
    typeof value.pushEnabled === 'boolean' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

function parseCircleContext(value: unknown): AssistantBootstrapResponse['contextCircle'] {
  if (value === null) return null;
  if (
    !isPlainObject(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !isStringArray(value.cities)
  ) {
    throw new Error('助手初始化数据格式异常');
  }
  return { id: value.id, name: value.name, cities: value.cities };
}

function parsePreferences(value: unknown): AssistantPreferences {
  // Backends from before user-level preferences omit the field; alerts default on.
  if (value === undefined) return { noteStatusAlerts: true };
  if (!isPlainObject(value) || typeof value.noteStatusAlerts !== 'boolean') {
    throw new Error('助手初始化数据格式异常');
  }
  return { noteStatusAlerts: value.noteStatusAlerts };
}

function parseBootstrap(value: unknown): AssistantBootstrapResponse {
  if (!isPlainObject(value) || !isPlainObject(value.assistant)) {
    throw new Error('助手初始化数据格式异常');
  }
  const assistant = value.assistant;
  const subscriptions =
    value.subscriptions === undefined ? [] : value.subscriptions;
  const capabilities =
    value.capabilities === undefined
      ? {
          infoSubscriptions: false,
          noteStatusAlerts: true,
          dailyDigest: false,
        }
      : value.capabilities;
  if (
    typeof assistant.key !== 'string' ||
    assistant.key.length === 0 ||
    typeof assistant.displayName !== 'string' ||
    typeof assistant.avatarKey !== 'string' ||
    typeof assistant.conversationId !== 'string' ||
    assistant.conversationId.length === 0 ||
    !isConversationShape(value.conversation) ||
    value.conversation.id !== assistant.conversationId ||
    typeof value.unreadCount !== 'number' ||
    !Number.isFinite(value.unreadCount) ||
    value.unreadCount < 0 ||
    !Array.isArray(subscriptions) ||
    !subscriptions.every(isSubscriptionShape) ||
    !isPlainObject(capabilities) ||
    typeof capabilities.infoSubscriptions !== 'boolean' ||
    typeof capabilities.noteStatusAlerts !== 'boolean' ||
    typeof capabilities.dailyDigest !== 'boolean'
  ) {
    throw new Error('助手初始化数据格式异常');
  }
  return {
    assistant: {
      key: assistant.key,
      displayName: assistant.displayName,
      avatarKey: assistant.avatarKey,
      conversationId: assistant.conversationId,
    },
    conversation: value.conversation,
    unreadCount: value.unreadCount,
    subscriptions: subscriptions.map((subscription) => ({
      ...subscription,
      keywords: subscription.keywords ?? [],
    })),
    contextCircle: parseCircleContext(value.contextCircle ?? null),
    preferences: parsePreferences(value.preferences),
    capabilities: {
      infoSubscriptions: capabilities.infoSubscriptions,
      noteStatusAlerts: capabilities.noteStatusAlerts,
      dailyDigest: capabilities.dailyDigest,
    },
  };
}

export async function fetchAssistantBootstrap(
  contextCircleId?: string | null,
): Promise<AssistantBootstrapResponse> {
  const raw = await apiClient<unknown>(
    `/assistant/bootstrap${buildQuery({ contextCircleId })}`,
  );
  return parseBootstrap(raw);
}

export async function createAssistantSubscription(input: {
  circleId: string;
  cities?: string[];
  keywords?: string[];
  pushEnabled?: boolean;
}): Promise<AssistantSubscription> {
  return apiClient<AssistantSubscription>('/assistant/subscriptions', {
    method: 'POST',
    body: input,
  });
}

export async function updateAssistantPreferences(
  input: AssistantPreferences,
): Promise<AssistantPreferences> {
  return apiClient<AssistantPreferences>('/assistant/preferences', {
    method: 'PATCH',
    body: input,
  });
}
