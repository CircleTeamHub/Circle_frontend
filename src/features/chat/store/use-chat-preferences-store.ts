import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvJsonStorage } from '@/storage';

export type ChatBackgroundPreference =
  | { mode: 'global' }
  | { mode: 'preset'; presetId: string }
  | { mode: 'image'; uri: string };

export type ChatBackgroundPreset = {
  id: string;
  color: string;
};

export const DEFAULT_CHAT_BACKGROUND_PREFERENCE = {
  mode: 'global',
} as const;

export const CHAT_BACKGROUND_PRESETS: ChatBackgroundPreset[] = [
  { id: 'morning-mist', color: '#EAF1FF' },
  { id: 'forest-breeze', color: '#E8F6EE' },
  { id: 'sunset-glow', color: '#FFF1E8' },
  { id: 'lavender-haze', color: '#F3ECFF' },
];

type ChatPreferencesState = {
  backgroundsByConversationID: Record<string, ChatBackgroundPreference>;
  getChatBackgroundPreference: (conversationID: string) => ChatBackgroundPreference;
  setChatBackgroundPreference: (
    conversationID: string,
    preference: ChatBackgroundPreference,
  ) => void;
  clearChatBackgroundPreference: (conversationID: string) => void;
  // 登出 teardown 用（#97）：背景偏好按 conversationID 归属账号，不得跨号残留。
  resetForLogout: () => void;
};

function findChatBackgroundPreset(presetId: string) {
  return CHAT_BACKGROUND_PRESETS.find((preset) => preset.id === presetId);
}

// 只负责背景视觉（颜色 / 图片）；不产出文案标签。此前有一份 i18n label（含 getChat-
// BackgroundPreferenceLabel / preset.labelKey）但无任何消费方，且在 useMemo 里调 i18n.t
// 不会随语言刷新，已作为死代码移除。
export function resolveChatBackgroundStyle(
  preference: ChatBackgroundPreference | null | undefined,
  fallbackColor: string,
) {
  switch (preference?.mode) {
    case 'preset': {
      const preset = findChatBackgroundPreset(preference.presetId);
      return { backgroundColor: preset?.color ?? fallbackColor };
    }
    case 'image':
      return { backgroundColor: fallbackColor, imageUri: preference.uri };
    case 'global':
    default:
      return { backgroundColor: fallbackColor };
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

      resetForLogout: () => set({ backgroundsByConversationID: {} }),
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
