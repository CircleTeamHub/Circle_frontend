import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvJsonStorage } from '@/storage';
import type { ChatTarget } from './types';

/** 「最近转发」最多记这么多个,横排一屏放得下、往右滑再看几个。 */
export const RECENT_FORWARD_LIMIT = 12;

interface RecentForwardTargetsState {
  /** 按账号分开存,切号后不会看到别人的转发记录。 */
  byUser: Record<string, ChatTarget[]>;
  record: (userId: string, targets: readonly ChatTarget[]) => void;
  remove: (userId: string, key: string) => void;
  clear: (userId: string) => void;
}

export const useRecentForwardTargetsStore = create<RecentForwardTargetsState>()(
  persist(
    (set) => ({
      byUser: {},
      record: (userId, targets) =>
        set((state) => {
          const incoming = targets.filter((target) => target.conversationId);
          const keys = new Set(incoming.map((target) => target.key));
          const kept = (state.byUser[userId] ?? []).filter((target) => !keys.has(target.key));
          return {
            byUser: {
              ...state.byUser,
              [userId]: [...incoming, ...kept].slice(0, RECENT_FORWARD_LIMIT),
            },
          };
        }),
      remove: (userId, key) =>
        set((state) => ({
          byUser: {
            ...state.byUser,
            [userId]: (state.byUser[userId] ?? []).filter((target) => target.key !== key),
          },
        })),
      clear: (userId) =>
        set((state) => ({ byUser: { ...state.byUser, [userId]: [] } })),
    }),
    {
      name: 'circle-im-recent-forward-targets',
      storage: createJSONStorage(() => mmkvJsonStorage),
    },
  ),
);
