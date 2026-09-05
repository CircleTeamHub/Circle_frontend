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
        set({
          pinnedFoldCount:
            Number.isFinite(value) && value >= 0
              ? Math.floor(value)
              : DEFAULT_PINNED_FOLD_COUNT,
        }),
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
          pinnedFoldCount:
            typeof persistedState.pinnedFoldCount === 'number'
              ? persistedState.pinnedFoldCount
              : DEFAULT_PINNED_FOLD_COUNT,
          settings: {
            ...appSettingsDefaults,
            ...persistedState.settings,
          },
        };
      },
    },
  ),
);
