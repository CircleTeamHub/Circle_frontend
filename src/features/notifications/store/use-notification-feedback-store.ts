import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvJsonStorage } from '@/storage';

/**
 * User preferences for the in-app notification banner's sound / haptic cue.
 * Persisted so the choice survives restarts. Both default on.
 */
interface NotificationFeedbackState {
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  setSoundEnabled: (value: boolean) => void;
  setHapticsEnabled: (value: boolean) => void;
}

export const useNotificationFeedbackStore = create<NotificationFeedbackState>()(
  persist(
    (set) => ({
      soundEnabled: true,
      hapticsEnabled: true,
      setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
      setHapticsEnabled: (hapticsEnabled) => set({ hapticsEnabled }),
    }),
    {
      name: 'circle-im-notification-feedback',
      storage: createJSONStorage(() => mmkvJsonStorage),
    },
  ),
);
