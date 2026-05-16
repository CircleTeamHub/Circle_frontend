import { create } from 'zustand';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';

// 用 dynamic import 避免 friends API 与 api/client → session → 本 store 的模块循环。
// refresh 仅在用户操作时调用，dynamic import 的延迟可忽略。
async function fetchUnreadFriendActivityCount() {
  const mod = await import('@/services/api/friends');
  return mod.fetchUnreadFriendActivityCount();
}

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
        useTabBadgeStore.getState().setContactsUnread(count);
      } catch (err) {
        // 拉取失败时保留上一次的本地计数。dev 下打印出来，避免长期 silent 回归。
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[friend-activity] refresh failed', err);
        }
        return get().count;
      }

      return get().count;
    },
    markRead: (activityIds) => {
      const uniqueCount = new Set(activityIds).size;
      const nextCount = Math.max(0, get().count - uniqueCount);

      set({ count: nextCount });
      useTabBadgeStore.getState().setContactsUnread(nextCount);
    },
    reset: () => {
      set({ count: 0 });
      useTabBadgeStore.getState().setContactsUnread(0);
    },
  }),
);
