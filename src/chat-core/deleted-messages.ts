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
  /**
   * 已删标识 → 删除时刻(毫秒)。值只用于超限淘汰,不参与判定。
   *
   * 键既可能是服务端 messageId,也可能是乐观消息的 d(幂等键)——
   * 删一条还没拿到 ack 的气泡时,手上只有 `local:<d>` 这个临时 id,
   * 而随后确认/回声带回来的是一个全新的服务端 id,按 id 判定必然漏网,
   * 删除会在慢网下当着用户的面自己撤销。所以 d 也要落一份。
   */
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

/**
 * 记一条墓碑(store.removeMessage 调用,所有删除入口都经过它)。
 * deliveryId 是乐观消息的幂等键:删的若是还没确认的气泡,只记 `local:<d>`
 * 挡不住随后带着新服务端 id 回来的那一条。
 */
export function markMessageDeletedLocally(
  messageId: string,
  deliveryId?: string | null,
): void {
  const store = useDeletedMessagesStore.getState();
  store.markDeleted(messageId);
  if (deliveryId) store.markDeleted(deliveryKey(deliveryId));
}

/** d 与 messageId 存在同一张表里,加前缀避免理论上的撞键。 */
function deliveryKey(deliveryId: string): string {
  return `d:${deliveryId}`;
}

/**
 * 这条消息是否已被本端删除。
 *
 * 所有把服务端消息呈现给用户的入口都要过它 —— 不只是入库:
 * 聊天记录的文本/媒体/文件/日期四屏与全局搜索都是直接渲染
 * searchChatMessages / searchAllChatMessages 的响应,不进 store,
 * 漏掉的话删过的消息会在搜索结果里原样重现,点进去还会跳到一条时间线里没有的目标。
 */
export function isMessageDeletedLocally(
  messageId: string,
  deliveryId?: string | null,
): boolean {
  const { deletedAtById } = useDeletedMessagesStore.getState();
  if (deletedAtById[messageId] !== undefined) return true;
  return deliveryId !== undefined && deliveryId !== null
    ? deletedAtById[deliveryKey(deliveryId)] !== undefined
    : false;
}

/** 过滤一批服务端返回的消息(搜索/历史屏共用)。 */
export function withoutLocallyDeleted<T extends { id: string; d?: string | null }>(
  messages: readonly T[],
): T[] {
  return messages.filter((m) => !isMessageDeletedLocally(m.id, m.d));
}
