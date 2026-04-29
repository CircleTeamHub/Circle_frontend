import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvJsonStorage } from '@/storage';

export type ChatBackgroundPreference =
  | { mode: 'global' }
  | { mode: 'preset'; presetId: string }
  | { mode: 'image'; uri: string };

export type ChatBackgroundPreset = {
  id: string;
  label: string;
  color: string;
};

export const DEFAULT_CHAT_BACKGROUND_PREFERENCE = {
  mode: 'global',
} as const;

export const CHAT_BACKGROUND_PRESETS: ChatBackgroundPreset[] = [
  { id: 'morning-mist', label: '晨雾蓝', color: '#EAF1FF' },
  { id: 'forest-breeze', label: '森林绿', color: '#E8F6EE' },
  { id: 'sunset-glow', label: '落日橙', color: '#FFF1E8' },
  { id: 'lavender-haze', label: '薰衣草紫', color: '#F3ECFF' },
];

type ChatPreferencesState = {
  backgroundsByConversationID: Record<string, ChatBackgroundPreference>;
  getChatBackgroundPreference: (conversationID: string) => ChatBackgroundPreference;
  setChatBackgroundPreference: (
    conversationID: string,
    preference: ChatBackgroundPreference,
  ) => void;
  clearChatBackgroundPreference: (conversationID: string) => void;
};

function findChatBackgroundPreset(presetId: string) {
  return CHAT_BACKGROUND_PRESETS.find((preset) => preset.id === presetId);
}

export function getChatBackgroundPreferenceLabel(
  preference?: ChatBackgroundPreference | null,
) {
  switch (preference?.mode) {
    case 'preset':
      return findChatBackgroundPreset(preference.presetId)?.label ?? '预设背景';
    case 'image':
      return '自定义图片';
    case 'global':
    default:
      return '跟随全局';
  }
}

export function resolveChatBackgroundStyle(
  preference: ChatBackgroundPreference | null | undefined,
  fallbackColor: string,
) {
  switch (preference?.mode) {
    case 'preset': {
      const preset = findChatBackgroundPreset(preference.presetId);
      return {
        backgroundColor: preset?.color ?? fallbackColor,
        label: preset?.label ?? '预设背景',
      };
    }
    case 'image':
      return {
        backgroundColor: fallbackColor,
        imageUri: preference.uri,
        label: '自定义图片',
      };
    case 'global':
    default:
      return {
        backgroundColor: fallbackColor,
        label: '跟随全局',
      };
  }
}

export const useChatPreferencesStore = create<ChatPreferencesState>()(
  persist(
    (set, get) => ({
      backgroundsByConversationID: {},

      getChatBackgroundPreference: (conversationID) =>
        get().backgroundsByConversationID[conversationID] ??
        DEFAULT_CHAT_BACKGROUND_PREFERENCE,

      setChatBackgroundPreference: (conversationID, preference) =>
        set((state) => {
          const nextBackgroundsByConversationID = {
            ...state.backgroundsByConversationID,
          };

          if (preference.mode === 'global') {
            delete nextBackgroundsByConversationID[conversationID];
          } else {
            nextBackgroundsByConversationID[conversationID] = preference;
          }

          return {
            backgroundsByConversationID: nextBackgroundsByConversationID,
          };
        }),

      clearChatBackgroundPreference: (conversationID) =>
        set((state) => {
          if (!(conversationID in state.backgroundsByConversationID)) {
            return state;
          }

          const nextBackgroundsByConversationID = {
            ...state.backgroundsByConversationID,
          };
          delete nextBackgroundsByConversationID[conversationID];

          return {
            backgroundsByConversationID: nextBackgroundsByConversationID,
          };
        }),
    }),
    {
      name: 'circle-im-chat-preferences',
      storage: createJSONStorage(() => mmkvJsonStorage),
      partialize: (state) => ({
        backgroundsByConversationID: state.backgroundsByConversationID,
      }),
    },
  ),
);
