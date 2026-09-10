import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvJsonStorage } from '@/storage';

/**
 * 圈子通知偏好，三档（对齐产品图）：
 *
 * - globalEnabled 全局接收圈子通知：总闸。关掉 = 横幅、声音、红点、离线推送全停，
 *   两个子开关同步置灰。
 * - soundEnabled  声音提醒：只管声音。关掉 = 静音，横幅和未读红点照常。
 * - offlineEnabled 离线提醒：APP 离线时收不收圈子推送。**由服务端执行**，这里存的
 *   是本地镜像，改动要同步给后端（syncCircleOfflinePush），否则只是个摆设。
 *
 * 子开关的实际生效值一律与总闸相与，见下面三个 selector —— 调用方不要各自再拼一遍，
 * 「总闸关了子项算不算数」这种语义只能有一处。
 */
interface CircleNotificationState {
  globalEnabled: boolean;
  soundEnabled: boolean;
  offlineEnabled: boolean;

  setGlobalEnabled: (value: boolean) => void;
  setSoundEnabled: (value: boolean) => void;
  setOfflineEnabled: (value: boolean) => void;
}

/** 要不要弹应用内横幅。 */
export function circleBannerAllowed(state: CircleNotificationState) {
  return state.globalEnabled;
}

/** 要不要为圈子通知播放提示音。 */
export function circleSoundAllowed(state: CircleNotificationState) {
  return state.globalEnabled && state.soundEnabled;
}

/** 要不要展示圈子未读红点。 */
export function circleBadgeAllowed(state: CircleNotificationState) {
  return state.globalEnabled;
}

/** 同步给服务端的离线推送开关取值。 */
export function circleOfflinePushAllowed(state: CircleNotificationState) {
  return state.globalEnabled && state.offlineEnabled;
}

export const useCircleNotificationStore = create<CircleNotificationState>()(
  persist(
    (set) => ({
      globalEnabled: true,
      soundEnabled: true,
      offlineEnabled: true,

      setGlobalEnabled: (value) => set({ globalEnabled: value }),
      setSoundEnabled: (value) => set({ soundEnabled: value }),
      setOfflineEnabled: (value) => set({ offlineEnabled: value }),
    }),
    {
      name: 'circle-im-circle-notification',
      storage: createJSONStorage(() => mmkvJsonStorage),
      version: 3,
      partialize: (state) => ({
        globalEnabled: state.globalEnabled,
        soundEnabled: state.soundEnabled,
        offlineEnabled: state.offlineEnabled,
      }),
      migrate: (persistedState) => {
        // 历史形状有三种：v0 globalEnabled、v1 inAppEnabled + bannerEnabled、
        // 以及中途只留 bannerEnabled 的那一版。旧版本只表达过「要不要弹横幅」，
        // 一律折叠进总闸；声音与离线是新增能力，默认打开（与产品图的
        // 「开启：默认打开离线通知+本地声音+红点」一致）。
        const previous = (persistedState ?? {}) as Partial<CircleNotificationState> & {
          globalEnabled?: boolean;
          inAppEnabled?: boolean;
          bannerEnabled?: boolean;
        };

        const legacyBannerOn = [
          previous.globalEnabled,
          previous.inAppEnabled,
          previous.bannerEnabled,
        ]
          .filter((value): value is boolean => typeof value === 'boolean')
          .every((value) => value);

        return {
          globalEnabled: legacyBannerOn,
          soundEnabled: true,
          offlineEnabled: true,
        } as CircleNotificationState;
      },
    },
  ),
);
