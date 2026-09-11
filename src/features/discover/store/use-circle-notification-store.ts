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
 *   是本地镜像，改动要同步给后端（见 circle-offline-push-sync），否则只是个摆设。
 *
 * 另有 bannerEnabled：v1 时代的「应用内横幅」开关。三档 UI 里没有它的行，也没有
 * setter —— 它现在只由 migrate 写一次。留着它是因为：历史用户关过的横幅不能因为
 * 升级就自己弹回来，而把「只关横幅」折进总闸又会顺手关掉红点和离线推送，那是另一
 * 件事。新装的用户拿默认值 true，这一格对他们等于不存在。
 *
 * 子开关的实际生效值一律与总闸相与，见下面的 selector —— 调用方不要各自再拼一遍，
 * 「总闸关了子项算不算数」这种语义只能有一处。
 *
 * 账号归属：offlineEnabled 镜像的是 User.circleOfflinePushEnabled 这个 per-user
 * 字段，所以整个 store 随账号走（session.ts 的登出清单），不跨号残留。
 */
interface CircleNotificationState {
  globalEnabled: boolean;
  bannerEnabled: boolean;
  soundEnabled: boolean;
  offlineEnabled: boolean;

  setGlobalEnabled: (value: boolean) => void;
  setSoundEnabled: (value: boolean) => void;
  setOfflineEnabled: (value: boolean) => void;
  resetForLogout: () => void;
}

export type CircleNotificationPreferences = Pick<
  CircleNotificationState,
  'globalEnabled' | 'bannerEnabled' | 'soundEnabled' | 'offlineEnabled'
>;

const DEFAULT_PREFERENCES: CircleNotificationPreferences = {
  globalEnabled: true,
  bannerEnabled: true,
  soundEnabled: true,
  offlineEnabled: true,
};

/** 要不要弹应用内横幅。 */
export function circleBannerAllowed(state: CircleNotificationPreferences) {
  return state.globalEnabled && state.bannerEnabled;
}

/** 要不要为圈子通知播放提示音。 */
export function circleSoundAllowed(state: CircleNotificationPreferences) {
  return state.globalEnabled && state.soundEnabled;
}

/** 要不要展示圈子未读红点。 */
export function circleBadgeAllowed(state: CircleNotificationPreferences) {
  return state.globalEnabled;
}

/** 同步给服务端的离线推送开关取值。 */
export function circleOfflinePushAllowed(state: CircleNotificationPreferences) {
  return state.globalEnabled && state.offlineEnabled;
}

/**
 * 一帧未读计数里与圈子有关的两格。discoverUnread 是互动域总数
 * （= 朋友圈 + 圈子 + 好友申请），circleUnread 是其中圈子那一份。
 */
export type CircleUnreadCounts = {
  discoverUnread?: number;
  circleUnread?: number;
};

/**
 * 总闸关掉时把圈子那份未读从展示里摘掉：圈子计数归零，互动总数扣掉它那一份
 * （扣不成负数）。计数只是不展示 —— 服务端照常累加，重新打开后下一次快照就把
 * 真实值补回来，入圈审批这类通知不会因此漏掉。
 *
 * 每一条写未读的路径都要过这里（badge.snapshot 帧、REST 恢复、
 * interaction.unread.changed），少一条就会在重启或重连后闪出红点。
 * 老后端不带 circleUnread 时扣不出圈子那一份，总数只能原样放行。
 */
export function gateCircleUnread(
  counts: CircleUnreadCounts,
  state: CircleNotificationPreferences,
): CircleUnreadCounts {
  if (circleBadgeAllowed(state)) return counts;
  const { discoverUnread, circleUnread } = counts;
  return {
    circleUnread: circleUnread === undefined ? undefined : 0,
    discoverUnread:
      discoverUnread === undefined || circleUnread === undefined
        ? discoverUnread
        : Math.max(0, discoverUnread - circleUnread),
  };
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * 历史形状：v0 只有 globalEnabled；v1 是 inAppEnabled（总闸）+ bannerEnabled（横幅）；
 * 中途还有一版只留 bannerEnabled。总闸 → globalEnabled，横幅 → bannerEnabled，各归各位，
 * 不把「关横幅」折成「全关」。声音与离线是新增能力，默认打开。纯函数，不碰网络 ——
 * 迁移出来的派生值不推给服务端，下次打开设置时以 GET 为准校一次。
 */
export function migrateCircleNotificationState(
  persistedState: unknown,
): CircleNotificationPreferences {
  const previous = (persistedState ?? {}) as Record<string, unknown>;
  return {
    globalEnabled:
      optionalBoolean(previous.globalEnabled) ??
      optionalBoolean(previous.inAppEnabled) ??
      DEFAULT_PREFERENCES.globalEnabled,
    bannerEnabled:
      optionalBoolean(previous.bannerEnabled) ?? DEFAULT_PREFERENCES.bannerEnabled,
    soundEnabled:
      optionalBoolean(previous.soundEnabled) ?? DEFAULT_PREFERENCES.soundEnabled,
    offlineEnabled:
      optionalBoolean(previous.offlineEnabled) ??
      DEFAULT_PREFERENCES.offlineEnabled,
  };
}

export const useCircleNotificationStore = create<CircleNotificationState>()(
  persist(
    (set) => ({
      ...DEFAULT_PREFERENCES,

      setGlobalEnabled: (value) => set({ globalEnabled: value }),
      setSoundEnabled: (value) => set({ soundEnabled: value }),
      setOfflineEnabled: (value) => set({ offlineEnabled: value }),
      resetForLogout: () => set({ ...DEFAULT_PREFERENCES }),
    }),
    {
      name: 'circle-im-circle-notification',
      storage: createJSONStorage(() => mmkvJsonStorage),
      version: 3,
      partialize: (state) => ({
        globalEnabled: state.globalEnabled,
        bannerEnabled: state.bannerEnabled,
        soundEnabled: state.soundEnabled,
        offlineEnabled: state.offlineEnabled,
      }),
      // persist 的默认 merge 是 {...currentState, ...persistedState}，所以
      // migrate 只需要返回持久化的那几格；actions 由 currentState 补齐。
      migrate: (persistedState) =>
        migrateCircleNotificationState(persistedState) as CircleNotificationState,
    },
  ),
);
