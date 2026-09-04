import { create } from 'zustand';

export type DirectMessageAutoReplyPreference = {
  enabled: boolean;
  message: string;
};

const DEFAULT_PREFERENCE: DirectMessageAutoReplyPreference = {
  enabled: false,
  message: '',
};

type DirectMessageAutoReplyState = {
  byUserId: Record<string, DirectMessageAutoReplyPreference>;
  getPreference: (userId: string) => DirectMessageAutoReplyPreference;
  setPreference: (
    userId: string,
    preference: DirectMessageAutoReplyPreference,
  ) => void;
  setDraftEnabled: (userId: string, enabled: boolean) => void;
  setDraftMessage: (userId: string, message: string) => void;
};

// 这里只保留当前页面的内存草稿。服务端是唯一权威来源，自动回复正文不再
// 落进本机普通持久化存储，换设备和离线时也由账号级设置继续生效。
export const useDirectMessageAutoReplyStore = create<DirectMessageAutoReplyState>()(
  (set, get) => ({
    byUserId: {},
    getPreference: (userId) => get().byUserId[userId] ?? DEFAULT_PREFERENCE,
    setPreference: (userId, preference) =>
      set((state) => ({
        byUserId: {
          ...state.byUserId,
          [userId]: {
            enabled: preference.enabled,
            message: preference.message.slice(0, 200),
          },
        },
      })),
    setDraftEnabled: (userId, enabled) =>
      set((state) => ({
        byUserId: {
          ...state.byUserId,
          [userId]: {
            ...(state.byUserId[userId] ?? DEFAULT_PREFERENCE),
            enabled,
          },
        },
      })),
    setDraftMessage: (userId, message) =>
      set((state) => ({
        byUserId: {
          ...state.byUserId,
          [userId]: {
            ...(state.byUserId[userId] ?? DEFAULT_PREFERENCE),
            message: message.slice(0, 200),
          },
        },
      })),
  }),
);
