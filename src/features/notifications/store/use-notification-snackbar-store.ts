import { create } from 'zustand';
import type { NotificationItem } from '@/types';

export type ChatSnackbarItem = {
  kind: 'chat';
  id: string;
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
 * We always keep the item currently on screen (queue[0]) and the most recent
 * tail, dropping the stale middle.
 */
const MAX_QUEUE = 12;

interface NotificationSnackbarState {
  queue: NotificationSnackbarItem[];
  current: NotificationSnackbarItem | null;
  enqueueNotification: (notification: NotificationItem) => void;
  enqueueChatMessage: (message: Omit<ChatSnackbarItem, 'kind'>) => void;
  dismissCurrent: () => void;
  reset: () => void;
}

function enqueue(
  get: () => NotificationSnackbarState,
  set: (partial: Partial<NotificationSnackbarState>) => void,
  item: NotificationSnackbarItem,
) {
  const { queue, current } = get();
  if (queue.some((queued) => queued.id === item.id)) {
    return;
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
