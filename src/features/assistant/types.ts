import type { ChatConversationDto } from '@/chat-core/protocol';

export const ASSISTANT_KEY = 'windnote-assistant';

export type AssistantCircleContext = {
  id: string;
  name: string;
  cities: string[];
};

export type AssistantSubscription = {
  id: string;
  circleId: string;
  circleName: string;
  circleCities: string[];
  cities: string[];
  followsCircleCities: boolean;
  sourceTypes: string[];
  enabled: boolean;
  pushEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AssistantBootstrapResponse = {
  assistant: {
    key: string;
    displayName: string;
    avatarKey: string;
    conversationId: string;
  };
  conversation: ChatConversationDto;
  unreadCount: number;
  subscriptions: AssistantSubscription[];
  contextCircle: AssistantCircleContext | null;
  capabilities: {
    infoSubscriptions: boolean;
    noteStatusAlerts: boolean;
    dailyDigest: boolean;
  };
};
