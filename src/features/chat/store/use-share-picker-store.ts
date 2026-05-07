import type { FriendProfile } from '@/services/api/friends';
import type { NoteSummary } from '@/features/notes/types';
import type { UserCollection } from '@/services/api/collections';
import { create } from 'zustand';

/**
 * SharePickerScreen 选完后写入这里；ChatDetailScreen 重新拿到焦点时
 * `consume()` 一次性取走并清空，触发对应消息发送。
 *
 * 不持久化 —— 跨屏一次性传值，关 app 就丢，没问题。
 */
export type SharePickedItem =
  | { kind: 'note'; data: NoteSummary }
  | { kind: 'friend'; data: FriendProfile }
  | { kind: 'favorite'; data: UserCollection }
  | { kind: 'quick-reply'; data: string };

interface SharePickerState {
  pending: SharePickedItem | null;
  setPending: (item: SharePickedItem) => void;
  consume: () => SharePickedItem | null;
}

export const useSharePickerStore = create<SharePickerState>((set, get) => ({
  pending: null,
  setPending: (item) => set({ pending: item }),
  consume: () => {
    const item = get().pending;
    if (item) set({ pending: null });
    return item;
  },
}));
