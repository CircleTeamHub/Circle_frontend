import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvJsonStorage } from '@/storage';

/**
 * 从聊天里把笔记添加到「我的笔记」时的两步确认,用户可以各自关掉:
 * 不选分组就放进「未分组」,不编辑标题就用原笔记标题。
 */
export interface NoteCollectPreferences {
  chooseGroup: boolean;
  editTitle: boolean;
}

export const DEFAULT_NOTE_COLLECT_PREFERENCES: NoteCollectPreferences = Object.freeze({
  chooseGroup: true,
  editTitle: true,
});

interface NoteCollectPreferencesState {
  /** 按账号分开存:A 关掉的确认步骤不会在同一台手机上的 B 账号里生效。 */
  byUser: Record<string, NoteCollectPreferences>;
  setPreference: (userId: string, patch: Partial<NoteCollectPreferences>) => void;
}

export function selectNoteCollectPreferences(
  state: Pick<NoteCollectPreferencesState, 'byUser'>,
  userId: string | null | undefined,
): NoteCollectPreferences {
  return (userId ? state.byUser[userId] : undefined) ?? DEFAULT_NOTE_COLLECT_PREFERENCES;
}

export const useNoteCollectPreferencesStore = create<NoteCollectPreferencesState>()(
  persist(
    (set) => ({
      byUser: {},
      setPreference: (userId, patch) =>
        set((state) => ({
          byUser: {
            ...state.byUser,
            [userId]: { ...selectNoteCollectPreferences(state, userId), ...patch },
          },
        })),
    }),
    {
      name: 'circle-im-note-collect-preferences',
      storage: createJSONStorage(() => mmkvJsonStorage),
      // v0 是整台设备共用的一份,分不清是哪个账号设的,升级时丢掉、回到默认。
      version: 1,
      migrate: () => ({ byUser: {} }),
      partialize: (state) => ({ byUser: state.byUser }),
    },
  ),
);

/** 当前账号的收藏确认偏好;没登录或没设过时是默认值。 */
export function useNoteCollectPreferences(userId: string | null | undefined): NoteCollectPreferences {
  return useNoteCollectPreferencesStore((state) => selectNoteCollectPreferences(state, userId));
}
