import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvJsonStorage } from '@/storage';

interface CircleNotificationState {
  globalEnabled: boolean;
  // 是否为圈子通知弹出横幅（原 soundEnabled 是从未生效的死设置，现改为控制横幅）。
  // 默认开启：与「横幅此前一直弹」的既有行为保持一致，避免接线后横幅突然消失。
  bannerEnabled: boolean;
  offlineEnabled: boolean;

  setGlobalEnabled: (value: boolean) => void;
  setBannerEnabled: (value: boolean) => void;
  setOfflineEnabled: (value: boolean) => void;
}

export const useCircleNotificationStore = create<CircleNotificationState>()(
  persist(
    (set) => ({
      globalEnabled: true,
      bannerEnabled: true,
      offlineEnabled: false,

      setGlobalEnabled: (value) => set({ globalEnabled: value }),
      setBannerEnabled: (value) => set({ bannerEnabled: value }),
      setOfflineEnabled: (value) => set({ offlineEnabled: value }),
    }),
    {
      name: 'circle-im-circle-notification',
      storage: createJSONStorage(() => mmkvJsonStorage),
      // 旧版本持久化里只有 soundEnabled（死设置）。浅合并时初始的 bannerEnabled:true
      // 不会被旧数据覆盖，横幅默认开启；残留的 soundEnabled 键无人读取、无害。
    },
  ),
);
