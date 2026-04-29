import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvJsonStorage } from '@/storage';

interface CircleNotificationState {
  globalEnabled: boolean;
  soundEnabled: boolean;
  offlineEnabled: boolean;

  setGlobalEnabled: (value: boolean) => void;
  setSoundEnabled: (value: boolean) => void;
  setOfflineEnabled: (value: boolean) => void;
}

export const useCircleNotificationStore = create<CircleNotificationState>()(
  persist(
    (set) => ({
      globalEnabled: true,
      soundEnabled: false,
      offlineEnabled: false,

      setGlobalEnabled: (value) => set({ globalEnabled: value }),
      setSoundEnabled: (value) => set({ soundEnabled: value }),
      setOfflineEnabled: (value) => set({ offlineEnabled: value }),
    }),
    {
      name: 'circle-im-circle-notification',
      storage: createJSONStorage(() => mmkvJsonStorage),
    },
  ),
);
