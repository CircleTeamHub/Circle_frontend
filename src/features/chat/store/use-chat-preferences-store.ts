import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvJsonStorage } from '@/storage';
// 只引纯判断模块。清理磁盘的那半带原生依赖，登出时才按需加载 —— 这个 store 会
// 被登出 teardown 和聊天页加载，不该顺带把原生模块拖进它的 import 图。
import { isLocalChatBackgroundImageUri } from '@/features/chat/utils/chat-background-uri';

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
  globalBackgroundPreference: ChatBackgroundPreference | null;
  backgroundsByConversationID: Record<string, ChatBackgroundPreference>;
  setGlobalBackgroundPreference: (
    preference: ChatBackgroundPreference | null,
  ) => void;
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
      // 非本地来源（历史遗留的对象存储直链）加载必失败，画出来只有蒙版那层灰。
      // 与其铺一层灰，不如老老实实退回默认底色。
      return isLocalChatBackgroundImageUri(preference.uri)
        ? { backgroundColor: fallbackColor, imageUri: preference.uri }
        : { backgroundColor: fallbackColor };
    case 'global':
    default:
      return { backgroundColor: fallbackColor };
  }
}

export function resolveEffectiveChatBackgroundPreference(
  conversationPreference: ChatBackgroundPreference | null | undefined,
  globalBackgroundPreference: ChatBackgroundPreference | null | undefined,
): ChatBackgroundPreference {
  if (!conversationPreference || conversationPreference.mode === 'global') {
    return globalBackgroundPreference ?? DEFAULT_CHAT_BACKGROUND_PREFERENCE;
  }
  return conversationPreference;
}

/**
 * 当前仍被引用的背景图 uri（全局 + 每个会话）。背景图的文件 GC 用它决定谁能删。
 */
function collectChatBackgroundImageUris(): string[] {
  const state = useChatPreferencesStore.getState();
  return [
    state.globalBackgroundPreference,
    ...Object.values(state.backgroundsByConversationID),
  ]
    .filter((preference) => preference?.mode === 'image')
    .map((preference) => (preference as { uri: string }).uri);
}

/**
 * 删掉磁盘（web 是 IndexedDB）上已经没人引用的背景图。
 *
 * 偏好清空和图片落盘是两件事：只清偏好，上一个账号的壁纸原封不动留在设备上，
 * 而引用先没了，谁也不会再来删它。所以**每一条清偏好的路径**都要顺手调这里，
 * 不只是 resetForLogout —— 登出被更新会话抢占时 session.ts 会跳过 resetForLogout
 * 但照样 clearStorage()，那一支才是真正会留下隐私残留的分支。
 *
 * 按「当前还被引用的」清而不是无脑清空：抢占场景下新账号可能已经设了背景，
 * 一刀切会把新账号刚选的壁纸删掉，留下一个引用得到却打不开的偏好。
 */
export async function clearUnreferencedChatBackgroundImages(): Promise<void> {
  try {
    const { pruneChatBackgroundImages } = await import(
      '@/features/chat/utils/chat-background-image'
    );
    await pruneChatBackgroundImages(collectChatBackgroundImageUris());
  } catch {
    // 清理是尽力而为：失败最多留下一个孤儿文件，不该把登出或换背景弄失败。
  }
}

/**
 * v0 → v1：v0 把背景图 PUT 到对象存储的 `chat/` 前缀并存了直链，而那个前缀不允许
 * 匿名读，于是每条存量记录都是一个恒 403 的 URL。用户不会自己想到「再选一次图」，
 * 所以这里直接把这些偏好丢掉，退回默认背景。
 */
function dropRemoteBackgroundPreference(
  preference: ChatBackgroundPreference | null | undefined,
): ChatBackgroundPreference | null {
  if (!preference) return null;
  if (preference.mode !== 'image') return preference;
  return isLocalChatBackgroundImageUri(preference.uri) ? preference : null;
}

export const useChatPreferencesStore = create<ChatPreferencesState>()(
  persist(
    (set, get) => ({
      globalBackgroundPreference: null,
      backgroundsByConversationID: {},

      setGlobalBackgroundPreference: (preference) =>
        set({
          globalBackgroundPreference:
            preference?.mode === 'global' ? null : preference,
        }),

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

      resetForLogout: () => {
        set({
          globalBackgroundPreference: null,
          backgroundsByConversationID: {},
        });
        // 偏好清了，磁盘上的背景图也不能留给下一个登录的账号。
        void clearUnreferencedChatBackgroundImages();
      },
    }),
    {
      name: 'circle-im-chat-preferences',
      version: 1,
      storage: createJSONStorage(() => mmkvJsonStorage),
      migrate: (persistedState) => {
        const state = (persistedState ?? {}) as Partial<ChatPreferencesState>;
        const backgroundsByConversationID: Record<
          string,
          ChatBackgroundPreference
        > = {};

        for (const [conversationID, preference] of Object.entries(
          state.backgroundsByConversationID ?? {},
        )) {
          const kept = dropRemoteBackgroundPreference(preference);
          if (kept) backgroundsByConversationID[conversationID] = kept;
        }

        return {
          ...state,
          globalBackgroundPreference: dropRemoteBackgroundPreference(
            state.globalBackgroundPreference,
          ),
          backgroundsByConversationID,
        } as ChatPreferencesState;
      },
      partialize: (state) => ({
        globalBackgroundPreference: state.globalBackgroundPreference,
        backgroundsByConversationID: state.backgroundsByConversationID,
      }),
    },
  ),
);
