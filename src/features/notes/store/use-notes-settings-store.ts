import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvJsonStorage } from '@/storage';

interface NotesSettingsState {
  confirmCardSave: boolean;
  defaultSaveCard: boolean;
  showMedia: boolean;
  showGroups: boolean;
  showUngrouped: boolean;
  showSortToolbar: boolean;
  lastForceSyncAt: number;

  setConfirmCardSave: (value: boolean) => void;
  setDefaultSaveCard: (value: boolean) => void;
  setShowMedia: (value: boolean) => void;
  setShowGroups: (value: boolean) => void;
  setShowUngrouped: (value: boolean) => void;
  setShowSortToolbar: (value: boolean) => void;
  markForceSync: () => void;
}

export const useNotesSettingsStore = create<NotesSettingsState>()(
  persist(
    (set) => ({
      confirmCardSave: false,
      defaultSaveCard: true,
      showMedia: true,
      showGroups: true,
      showUngrouped: true,
      showSortToolbar: true,
      lastForceSyncAt: 0,

      setConfirmCardSave: (value) => set({ confirmCardSave: value }),
      setDefaultSaveCard: (value) => set({ defaultSaveCard: value }),
      setShowMedia: (value) => set({ showMedia: value }),
      setShowGroups: (value) => set({ showGroups: value }),
      setShowUngrouped: (value) => set({ showUngrouped: value }),
      setShowSortToolbar: (value) => set({ showSortToolbar: value }),
      markForceSync: () => set({ lastForceSyncAt: Date.now() }),
    }),
    {
      name: 'circle-im-notes-settings',
      storage: createJSONStorage(() => mmkvJsonStorage),
    },
  ),
);

export const FORCE_SYNC_COOLDOWN_MS = 30_000;
