import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvJsonStorage } from '@/storage';
import {
  clearLocalUnreadOverride,
  setLocalUnreadOverride,
  type LocalUnreadOverrides,
} from '@/features/messages/utils/local-unread';

interface LocalUnreadState {
  overrides: LocalUnreadOverrides;
  markUnread: (conversationID: string) => void;
  clearUnread: (conversationID: string) => void;
  clearMany: (conversationIDs: string[]) => void;
  // 登出 teardown 用（#97）：overrides 按 conversationID 记账号私有数据，
  // 换号后残留会把上一账号的幻影未读点带进下一账号的会话列表。
  resetForLogout: () => void;
}

export const useLocalUnreadStore = create<LocalUnreadState>()(
  persist(
    (set) => ({
      overrides: {},
      markUnread: (conversationID) =>
        set((state) => ({
          overrides: setLocalUnreadOverride(state.overrides, conversationID),
        })),
      clearUnread: (conversationID) =>
        set((state) => ({
          overrides: clearLocalUnreadOverride(state.overrides, conversationID),
        })),
      clearMany: (conversationIDs) =>
        set((state) => {
          const targets = new Set(conversationIDs);
          if (targets.size === 0) return state;
          const next = { ...state.overrides };
          let changed = false;
          for (const id of targets) {
            if (next[id]) {
              delete next[id];
              changed = true;
            }
          }
          return changed ? { overrides: next } : state;
        }),
      resetForLogout: () => set({ overrides: {} }),
    }),
    {
      name: 'circle-im-local-unread-overrides',
      storage: createJSONStorage(() => mmkvJsonStorage),
      partialize: (state) => ({ overrides: state.overrides }),
    },
  ),
);
