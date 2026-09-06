import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvJsonStorage } from '@/storage';

export const appSettingsDefaults = {
  singleDeviceLogin: false,
  deviceLock: false,
  pushNotifications: true,
  friendRequestNotifications: true,
  groupRequestNotifications: true,
  groupGlobalPush: true,
  groupOnlinePush: true,
  groupOfflinePush: false,
  hideChatAvatar: false,
  mergeAvatar: false,
  showGroupTags: true,
  showOriginalGroupName: false,
  batteryOptimizationReminder: true,
  selfDestructTip: true,
  onlineTime: true,
  strangerMessage: true,
  singleTyping: true,
  groupTyping: true,
  showPhone: false,
  showWechat: true,
  showQQ: true,
  personalizedRecommendation: false,
  youthMode: false,
} as const;

export type AppSettingKey = keyof typeof appSettingsDefaults;
export const DEFAULT_PINNED_FOLD_COUNT = 5;

/**
 * 折叠阈值的唯一收口。
 *
 * setter 一直就有这道校验，但**水合**只查了 `typeof === 'number'` —— NaN、
 * Infinity、负数全都是 number，于是持久化里存进去的任何一个坏值都会原样活过重启。
 * NaN 尤其安静：`pinnedFoldCount === 0` 是假、`visiblePinned <= NaN` 也是假，
 * 于是置顶折叠既不展开也不收起，用户只看到列表不对，没有任何报错。
 */
function normalizePinnedFoldCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : DEFAULT_PINNED_FOLD_COUNT;
}

type AppSettingsValues = Record<AppSettingKey, boolean>;

interface AppSettingsState {
  settings: AppSettingsValues;
  pinnedFoldCount: number;
  setSetting: (key: AppSettingKey, value: boolean) => void;
  setPinnedFoldCount: (value: number) => void;
}

export const useAppSettingsStore = create<AppSettingsState>()(
  persist(
    (set) => ({
      settings: appSettingsDefaults,
      pinnedFoldCount: DEFAULT_PINNED_FOLD_COUNT,
      setSetting: (key, value) =>
        set((state) => ({
          settings: {
            ...state.settings,
            [key]: value,
          },
        })),
      setPinnedFoldCount: (value) =>
        set({ pinnedFoldCount: normalizePinnedFoldCount(value) }),
    }),
    {
      name: 'circle-im-app-settings',
      storage: createJSONStorage(() => mmkvJsonStorage),
      merge: (persisted, current) => {
        const persistedState =
          typeof persisted === 'object' && persisted !== null
            ? (persisted as Partial<AppSettingsState>)
            : {};

        return {
          ...current,
          ...persistedState,
          pinnedFoldCount: normalizePinnedFoldCount(
            persistedState.pinnedFoldCount,
          ),
          settings: {
            ...appSettingsDefaults,
            ...persistedState.settings,
          },
        };
      },
    },
  ),
);
