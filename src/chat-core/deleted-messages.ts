import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvJsonStorage } from '@/storage';

/**
 * 本地删除墓碑。
 *
 * 「删除」在自研栈里只是把消息从内存数组里摘掉,服务端那条原封不动 ——
 * 于是任何一次历史拉取(重进会话 / 触底翻页 / 分发器补拉)都会把它原样塞回来,
 * 一个自称删除的动作退化成刷新一次就复活的假动作。落盘一份已删 id、入库前统一
 * 过滤,删除才在重启之后依然成立。
 *
 * 不挂进登出 teardown:墓碑只是一串服务端生成的消息 id(全局唯一,不会跨账号撞),
 * 清掉的话同一个人重新登录时删过的消息会全部复活 —— 那正是要修的毛病。
 */

/** 墓碑上限。超出后按删除时间淘汰最旧的,避免长期使用把 MMKV 撑到无界。 */
export const DELETED_MESSAGES_CAP = 500;

interface DeletedMessagesState {
  /** messageId → 删除时刻(毫秒)。值只用于超限淘汰,不参与判定。 */
  deletedAtById: Record<string, number>;
  markDeleted: (messageId: string) => void;
  /** 测试与「清空聊天记录」之外不该调用:墓碑清了删除就失效了。 */
  clearAll: () => void;
}

export const useDeletedMessagesStore = create<DeletedMessagesState>()(
  persist(
    (set, get) => ({
      deletedAtById: {},

      markDeleted: (messageId) => {
        const current = get().deletedAtById;
        if (current[messageId] !== undefined) return;
        const next: Record<string, number> = { ...current, [messageId]: Date.now() };
        const ids = Object.keys(next);
        if (ids.length > DELETED_MESSAGES_CAP) {
          const oldestFirst = ids.sort((a, b) => next[a] - next[b]);
          for (const id of oldestFirst.slice(0, ids.length - DELETED_MESSAGES_CAP)) {
            delete next[id];
          }
        }
        set({ deletedAtById: next });
      },

      clearAll: () => set({ deletedAtById: {} }),
    }),
    {
      name: 'circle-im-chat-deleted-messages',
      storage: createJSONStorage(() => mmkvJsonStorage),
      partialize: (state) => ({ deletedAtById: state.deletedAtById }),
    },
  ),
);

/** 记一条墓碑(store.removeMessage 调用,所有删除入口都经过它)。 */
export function markMessageDeletedLocally(messageId: string): void {
  useDeletedMessagesStore.getState().markDeleted(messageId);
}

/** 入库过滤用的判定。 */
export function isMessageDeletedLocally(messageId: string): boolean {
  return useDeletedMessagesStore.getState().deletedAtById[messageId] !== undefined;
}
