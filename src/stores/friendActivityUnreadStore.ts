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
  /** Whether count came from a successful refresh or an authoritative realtime event. */
  countKnown: boolean;
  // 已本地扣减过的 activityId 身份表：同一行重复点击只扣一次（#105 双重扣减）。
  // refresh() 拿到服务端权威计数后清空 —— 那份计数已包含（或推翻）这些本地已读，
  // 之后同一行如果服务端仍算未读（mark-read 请求失败），再点仍能正确扣。
  locallyReadIds: ReadonlySet<string>;
  refresh: () => Promise<number>;
  setRealtimeCount: (count: number) => void;
  markRead: (activityIds: string[]) => void;
  reset: () => void;
};

let refreshGeneration = 0;

export const useFriendActivityUnreadStore = create<FriendActivityUnreadState>(
  (set, get) => ({
    count: 0,
    countKnown: false,
    locallyReadIds: new Set<string>(),
    refresh: async () => {
      const generation = ++refreshGeneration;

      try {
        const count = await fetchUnreadFriendActivityCount();
        if (generation !== refreshGeneration) {
          return get().count;
        }

        set({ count, countKnown: true, locallyReadIds: new Set<string>() });
        useTabBadgeStore.getState().setContactsUnread(count);
      } catch (err) {
        if (generation !== refreshGeneration) {
          return get().count;
        }

        // 保留本地计数供后续对账，隐藏无法确认的数字，避免把旧数当作当前未读。
        set({ countKnown: false });
        useTabBadgeStore.getState().setContactsUnread(0);
        reportHandledFailure('friendActivity', 'refreshUnread', err);
        return get().count;
      }

      return get().count;
    },
    setRealtimeCount: (count) => {
      refreshGeneration += 1;
      set({ count, countKnown: true });
      useTabBadgeStore.getState().setContactsUnread(count);
    },
    markRead: (activityIds) => {
      const { count, countKnown, locallyReadIds } = get();
      const freshIds = [...new Set(activityIds)].filter(
        (id) => !locallyReadIds.has(id),
      );
      if (freshIds.length === 0) {
        return;
      }

      // A local read is a newer fact than any unread-count request
      // already in flight. Ignore that request if it resolves afterwards.
      refreshGeneration += 1;
      const nextReadIds = new Set(locallyReadIds);
      freshIds.forEach((id) => nextReadIds.add(id));
      const nextCount = Math.max(0, count - freshIds.length);

      set({ count: nextCount, locallyReadIds: nextReadIds });
      useTabBadgeStore.getState().setContactsUnread(countKnown ? nextCount : 0);
    },
    reset: () => {
      refreshGeneration += 1;
      set({ count: 0, countKnown: false, locallyReadIds: new Set<string>() });
      useTabBadgeStore.getState().setContactsUnread(0);
    },
  }),
);
