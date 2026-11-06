import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvJsonStorage } from '@/storage';

/**
 * 从聊天里把笔记添加到「我的笔记」时的两步确认,用户可以各自关掉:
 * 不选分组就放进「未分组」,不编辑标题就用原笔记标题。
 */
interface NoteCollectPreferencesState {
  chooseGroup: boolean;
  editTitle: boolean;
  setChooseGroup: (value: boolean) => void;
  setEditTitle: (value: boolean) => void;
}

export const useNoteCollectPreferencesStore = create<NoteCollectPreferencesState>()(
  persist(
    (set) => ({
      chooseGroup: true,
      editTitle: true,
      setChooseGroup: (value) => set({ chooseGroup: value }),
      setEditTitle: (value) => set({ editTitle: value }),
    }),
    {
      name: 'circle-im-note-collect-preferences',
      storage: createJSONStorage(() => mmkvJsonStorage),
    },
  ),
);
