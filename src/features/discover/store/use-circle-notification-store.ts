import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvJsonStorage } from '@/storage';

interface CircleNotificationState {
  inAppEnabled: boolean;
  // 是否为圈子通知弹出横幅（原 soundEnabled 是从未生效的死设置，现改为控制横幅）。
  // 默认开启：与「横幅此前一直弹」的既有行为保持一致，避免接线后横幅突然消失。
  bannerEnabled: boolean;

  setInAppEnabled: (value: boolean) => void;
  setBannerEnabled: (value: boolean) => void;
}

export const useCircleNotificationStore = create<CircleNotificationState>()(
  persist(
    (set) => ({
      inAppEnabled: true,
      bannerEnabled: true,

      setInAppEnabled: (value) => set({ inAppEnabled: value }),
      setBannerEnabled: (value) => set({ bannerEnabled: value }),
    }),
    {
      name: 'circle-im-circle-notification',
      storage: createJSONStorage(() => mmkvJsonStorage),
      version: 1,
      partialize: (state) => ({
        inAppEnabled: state.inAppEnabled,
        bannerEnabled: state.bannerEnabled,
      }),
      migrate: (persistedState) => {
        const previous = (persistedState ?? {}) as Partial<CircleNotificationState> & {
          globalEnabled?: boolean;
        };
        return {
          inAppEnabled:
            typeof previous.inAppEnabled === 'boolean'
              ? previous.inAppEnabled
              : previous.globalEnabled ?? true,
          bannerEnabled:
            typeof previous.bannerEnabled === 'boolean'
              ? previous.bannerEnabled
              : true,
        };
      },
    },
  ),
);
