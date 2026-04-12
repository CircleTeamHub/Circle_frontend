import { fetchUnreadFriendActivityCount } from '@/services/api/friends';
import { create } from 'zustand';

type FriendActivityUnreadState = {
  count: number;
  refresh: () => Promise<number>;
  markRead: (activityIds: string[]) => void;
  reset: () => void;
};

export const useFriendActivityUnreadStore = create<FriendActivityUnreadState>(
  (set, get) => ({
    count: 0,
    refresh: async () => {
      try {
        const count = await fetchUnreadFriendActivityCount();
        set({ count });
      } catch {
        return get().count;
      }

      return get().count;
    },
    markRead: (activityIds) => {
      const uniqueCount = new Set(activityIds).size;

      set((state) => ({
        count: Math.max(0, state.count - uniqueCount),
      }));
    },
    reset: () => {
      set({ count: 0 });
    },
  }),
);
