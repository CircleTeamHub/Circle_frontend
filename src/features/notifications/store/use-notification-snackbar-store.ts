import { create } from 'zustand';
import type { NotificationItem } from '@/types';

export type ChatSnackbarItem = {
  kind: 'chat';
  id: string;
  /**
   * 正在显示的横幅被同一会话的新消息替换时,沿用原来那条的横幅 id
   * (见 snackbarBannerKey):界面据此只换内容,不当成一条新横幅。
   */
  bannerId?: string;
  /**
   * 被它替换掉的那些消息 id。重连后服务端可能把其中一条再投一遍,认出来才不会
   * 把横幅换回旧内容。只留最近几条。
   */
  mergedIds?: readonly string[];
  title: string;
  summary: string;
  avatarUrl: string | null;
  conversationID: string;
  sourceID: string;
  conversationType: 'private' | 'group';
};

export type NotificationSnackbarItem =
  | ({ kind: 'notification' } & NotificationItem)
  | ChatSnackbarItem;

/**
 * Upper bound on pending banners. Without this, a burst of inbound messages
 * would march one-by-one for AUTO_DISMISS_MS each (queue.length * 4s),
 * effectively freezing the banner slot and growing memory unbounded.
 * We always keep the item currently on screen (queue[0]) and the tail, dropping
 * the middle. Chat banners are merged per conversation and keep their place, so
 * the order is by when each conversation first got a banner, not by its latest
 * message.
 */
const MAX_QUEUE = 12;
/** 每条横幅最多记几条被它替换掉的消息 id(防重投,够用就行)。 */
const MAX_MERGED_IDS = 20;

interface NotificationSnackbarState {
  queue: NotificationSnackbarItem[];
  current: NotificationSnackbarItem | null;
  enqueueNotification: (notification: NotificationItem) => void;
  enqueueChatMessage: (message: Omit<ChatSnackbarItem, 'kind'>) => void;
  dismissCurrent: () => void;
  reset: () => void;
}

/** 横幅这一格的身份:同一会话的新消息替换正在显示的那条时保持不变。 */
export function snackbarBannerKey(item: NotificationSnackbarItem): string {
  return item.kind === 'chat' ? (item.bannerId ?? item.id) : item.id;
}

function enqueue(
  get: () => NotificationSnackbarState,
  set: (partial: Partial<NotificationSnackbarState>) => void,
  item: NotificationSnackbarItem,
) {
  const { queue, current } = get();
  if (
    queue.some(
      (queued) =>
        queued.id === item.id ||
        (queued.kind === 'chat' && queued.mergedIds?.includes(item.id)),
    )
  ) {
    return;
  }

  // 同一个会话只留一条横幅,新消息替换旧的。原来每条消息排一个(各 4 秒):群一多,
  // 横幅一个接一个停不下来,每个都要重新进场、再响一次。
  // 排着的原位替换;正在显示的(队头)沿用原横幅 id,界面只换内容 —— 不重新进场、
  // 不再响、不重新计时,一个活跃的群也就挂不住这一格。
  if (item.kind === 'chat') {
    const index = queue.findIndex(
      (queued) =>
        queued.kind === 'chat' && queued.conversationID === item.conversationID,
    );
    if (index >= 0) {
      const replaced = queue[index] as ChatSnackbarItem;
      const merged: ChatSnackbarItem = {
        ...item,
        mergedIds: [...(replaced.mergedIds ?? []), replaced.id].slice(-MAX_MERGED_IDS),
      };
      const replacement: NotificationSnackbarItem =
        index === 0 ? { ...merged, bannerId: snackbarBannerKey(replaced) } : merged;
      const nextQueue = queue.map((queued, position) =>
        position === index ? replacement : queued,
      );
      set({ queue: nextQueue, current: nextQueue[0] });
      return;
    }
  }

  let nextQueue = [...queue, item];
  if (nextQueue.length > MAX_QUEUE) {
    // Keep the on-screen item (head) and the most recent tail.
    nextQueue = [nextQueue[0], ...nextQueue.slice(-(MAX_QUEUE - 1))];
  }

  set({ queue: nextQueue, current: current ?? item });
}

export const useNotificationSnackbarStore = create<NotificationSnackbarState>(
  (set, get) => ({
    queue: [],
    current: null,
    enqueueNotification: (notification) => {
      enqueue(get, set, { ...notification, kind: 'notification' });
    },
    enqueueChatMessage: (message) => {
      enqueue(get, set, { ...message, kind: 'chat' });
    },
    dismissCurrent: () => {
      const [, ...remaining] = get().queue;
      set({
        queue: remaining,
        current: remaining[0] ?? null,
      });
    },
    reset: () => set({ queue: [], current: null }),
  }),
);
