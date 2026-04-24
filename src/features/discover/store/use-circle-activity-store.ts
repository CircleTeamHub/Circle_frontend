import { create } from 'zustand';
import {
  fetchCircleActivityUnreadCount,
  markCircleActivityRead,
} from '@/services/api/circles';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';

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
        useTabBadgeStore.getState().setDiscoverUnread(count);
      } catch {
        // silently fail
      }
    },

    markRead: (activityIds) => {
      const nextCount = Math.max(0, get().count - activityIds.length);
      set({ count: nextCount });
      useTabBadgeStore.getState().setDiscoverUnread(nextCount);
      for (const id of activityIds) {
        markCircleActivityRead(id).catch(() => {});
      }
    },

    reset: () => {
      set({ count: 0 });
      useTabBadgeStore.getState().setDiscoverUnread(0);
    },
  }),
);
