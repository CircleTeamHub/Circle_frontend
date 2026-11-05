import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvJsonStorage } from '@/storage';

/**
 * User preferences for the in-app notification banner's sound / haptic cue.
 * Persisted so the choice survives restarts. Both default on.
 */
export type NotificationRingtone = 'default' | 'soft' | 'bell';

interface NotificationFeedbackState {
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  messageRingtone: NotificationRingtone;
  circleRingtone: NotificationRingtone;
  setSoundEnabled: (value: boolean) => void;
  setHapticsEnabled: (value: boolean) => void;
  setMessageRingtone: (value: NotificationRingtone) => void;
  setCircleRingtone: (value: NotificationRingtone) => void;
}

export const useNotificationFeedbackStore = create<NotificationFeedbackState>()(
  persist(
    (set) => ({
      soundEnabled: true,
      hapticsEnabled: true,
      messageRingtone: 'default',
      circleRingtone: 'default',
      setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
      setHapticsEnabled: (hapticsEnabled) => set({ hapticsEnabled }),
      setMessageRingtone: (messageRingtone) => set({ messageRingtone }),
      setCircleRingtone: (circleRingtone) => set({ circleRingtone }),
    }),
    {
      name: 'circle-im-notification-feedback',
      storage: createJSONStorage(() => mmkvJsonStorage),
    },
  ),
);
