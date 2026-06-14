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

type AppSettingsValues = Record<AppSettingKey, boolean>;

interface AppSettingsState {
  settings: AppSettingsValues;
  setSetting: (key: AppSettingKey, value: boolean) => void;
}

export const useAppSettingsStore = create<AppSettingsState>()(
  persist(
    (set) => ({
      settings: appSettingsDefaults,
      setSetting: (key, value) =>
        set((state) => ({
          settings: {
            ...state.settings,
            [key]: value,
          },
        })),
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
          settings: {
            ...appSettingsDefaults,
            ...persistedState.settings,
          },
        };
      },
    },
  ),
);
