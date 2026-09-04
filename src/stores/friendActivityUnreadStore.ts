import { create } from 'zustand';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { reportHandledFailure } from '@/observability/report-failure';

// 用 dynamic import 避免 friends API 与 api/client → session → 本 store 的模块循环。
// refresh 仅在用户操作时调用，dynamic import 的延迟可忽略。
async function fetchUnreadFriendActivityCount() {
  const mod = await import('@/services/api/friends');
  return mod.fetchUnreadFriendActivityCount();
}

type FriendActivityUnreadState = {
  count: number;
  // 已本地扣减过的 activityId 身份表：同一行重复点击只扣一次（#105 双重扣减）。
  // refresh() 拿到服务端权威计数后清空 —— 那份计数已包含（或推翻）这些本地已读，
  // 之后同一行如果服务端仍算未读（mark-read 请求失败），再点仍能正确扣。
  locallyReadIds: ReadonlySet<string>;
  refresh: () => Promise<number>;
  markRead: (activityIds: string[]) => void;
  reset: () => void;
};

export const useFriendActivityUnreadStore = create<FriendActivityUnreadState>(
  (set, get) => ({
    count: 0,
    locallyReadIds: new Set<string>(),
    refresh: async () => {
      try {
        const count = await fetchUnreadFriendActivityCount();
        set({ count, locallyReadIds: new Set<string>() });
        useTabBadgeStore.getState().setContactsUnread(count);
      } catch (err) {
        // 拉取失败时保留上一次的本地计数。dev 下打印出来，避免长期 silent 回归。
        reportHandledFailure('friendActivity', 'refreshUnread', err);
        return get().count;
      }

      return get().count;
    },
    markRead: (activityIds) => {
      const { count, locallyReadIds } = get();
      const freshIds = [...new Set(activityIds)].filter(
        (id) => !locallyReadIds.has(id),
      );
      if (freshIds.length === 0) {
        return;
      }

      const nextReadIds = new Set(locallyReadIds);
      freshIds.forEach((id) => nextReadIds.add(id));
      const nextCount = Math.max(0, count - freshIds.length);

      set({ count: nextCount, locallyReadIds: nextReadIds });
      useTabBadgeStore.getState().setContactsUnread(nextCount);
    },
    reset: () => {
      set({ count: 0, locallyReadIds: new Set<string>() });
      useTabBadgeStore.getState().setContactsUnread(0);
    },
  }),
);
