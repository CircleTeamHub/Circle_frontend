import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvJsonStorage } from '@/storage';
import {
  DEFAULT_NOTE_SORT_MODE,
  type NoteSortMode,
} from '@/features/notes/utils/note-sort';

/**
 * 「我的笔记」的排序方式与手动顺序，按账号分开存在本机：
 * 下次进来默认用上一次选的排序方式；手动顺序是全部笔记的一条完整顺序，各分组按它过滤着显示。
 */
export interface NotesSortPreference {
  mode: NoteSortMode;
  manualOrder: string[];
}

const DEFAULT_PREFERENCE: NotesSortPreference = Object.freeze({
  mode: DEFAULT_NOTE_SORT_MODE,
  manualOrder: [],
}) as NotesSortPreference;

interface NotesSortState {
  byUser: Record<string, NotesSortPreference>;
  setMode: (userId: string, mode: NoteSortMode) => void;
  setManualOrder: (userId: string, manualOrder: string[]) => void;
}

export function selectNotesSortPreference(
  state: Pick<NotesSortState, 'byUser'>,
  userId: string | null | undefined,
): NotesSortPreference {
  return (userId ? state.byUser[userId] : undefined) ?? DEFAULT_PREFERENCE;
}

export const useNotesSortStore = create<NotesSortState>()(
  persist(
    (set) => ({
      byUser: {},
      setMode: (userId, mode) =>
        set((state) => ({
          byUser: {
            ...state.byUser,
            [userId]: { ...selectNotesSortPreference(state, userId), mode },
          },
        })),
      setManualOrder: (userId, manualOrder) =>
        set((state) => ({
          byUser: {
            ...state.byUser,
            [userId]: { ...selectNotesSortPreference(state, userId), manualOrder },
          },
        })),
    }),
    {
      name: 'circle-im-notes-sort',
      storage: createJSONStorage(() => mmkvJsonStorage),
      partialize: (state) => ({ byUser: state.byUser }),
    },
  ),
);
