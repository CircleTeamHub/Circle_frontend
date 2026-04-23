import { create } from 'zustand';
import {
  fetchCircleActivityUnreadCount,
  markCircleActivityRead,
} from '@/services/api/circles';

interface CircleActivityState {
  count: number;
  refresh: () => Promise<void>;
  markRead: (activityIds: string[]) => void;
  reset: () => void;
}

export const useCircleActivityStore = create<CircleActivityState>(
  (set, get) => ({
    count: 0,

    refresh: async () => {
      try {
        const count = await fetchCircleActivityUnreadCount();
        set({ count });
      } catch {
        // silently fail
      }
    },

    markRead: (activityIds) => {
      const current = get().count;
      set({ count: Math.max(0, current - activityIds.length) });
      for (const id of activityIds) {
        markCircleActivityRead(id).catch(() => {});
      }
    },

    reset: () => set({ count: 0 }),
  }),
);
