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
  keywords: string[];
  followsCircleCities: boolean;
  sourceTypes: string[];
  enabled: boolean;
  pushEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

/** User-level settings, independent of any circle subscription. */
export type AssistantPreferences = {
  /** Remind when a note in the library is marked closed (打烊) or working (开工) at its source. */
  noteStatusAlerts: boolean;
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
  preferences: AssistantPreferences;
  capabilities: {
    infoSubscriptions: boolean;
    noteStatusAlerts: boolean;
    dailyDigest: boolean;
  };
};
